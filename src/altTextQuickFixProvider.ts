/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import path from 'path';
import { extractImageAttributes } from './utils/imageUtils';
import { generateAltText } from './utils/vscodeImageUtils';
import { initializeModelAndToken } from './extension';

interface ImageCodeAction extends vscode.CodeAction {
	document: vscode.TextDocument;
	range: vscode.Range;
	resolvedImagePath: string;
	currentLine: string;
	altTextStartIndex: number;
	isHtml: boolean;
	altTextLength: number;
	type: 'generate' | 'refine';
	isAI: boolean;
	isUrl?: boolean;
}

export class AltTextQuickFixProvider implements vscode.CodeActionProvider<ImageCodeAction> {
	private context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}
	public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
	async provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<ImageCodeAction[] | undefined> {
		const currentLine = document.lineAt(range.start.line).text;
		const shouldGenerate = extractImageAttributes(currentLine);
		const shouldRefineExisting = extractImageAttributes(currentLine, true);
		if (!shouldGenerate && !shouldRefineExisting) {
			return;
		}

		if (shouldGenerate) {
			const isUrl = isValidUrl(shouldGenerate.imagePath);
			const resolvedImagePath = isUrl ? shouldGenerate.imagePath : path.resolve(path.dirname(document.uri.fsPath), shouldGenerate.imagePath);
			return [{
				title: vscode.l10n.t('Generate alt text'),
				kind: vscode.CodeActionKind.QuickFix,
				range,
				document,
				resolvedImagePath,
				altTextStartIndex: shouldGenerate.altTextStartIndex,
				isHtml: shouldGenerate.isHTML,
				currentLine,
				type: 'generate',
				altTextLength: shouldGenerate.altTextLength,
				isAI: true,
				isUrl
			}];
		} else if (shouldRefineExisting) {
			const isUrl = isValidUrl(shouldRefineExisting.imagePath);
			const resolvedImagePath = isUrl ? shouldRefineExisting.imagePath : path.resolve(path.dirname(document.uri.fsPath), shouldRefineExisting.imagePath);
			return [{
				title: vscode.l10n.t('Refine alt text'),
				kind: vscode.CodeActionKind.QuickFix,
				range,
				document,
				resolvedImagePath,
				altTextStartIndex: shouldRefineExisting.altTextStartIndex,
				isHtml: shouldRefineExisting.isHTML,
				currentLine,
				type: 'refine',
				altTextLength: shouldRefineExisting.altTextLength,
				isAI: true,
				isUrl
			}];
		}
	}

	async resolveCodeAction(codeAction: ImageCodeAction, token: vscode.CancellationToken): Promise<ImageCodeAction | undefined> {
		if (token.isCancellationRequested) {
			return;
		}

		const { currentToken, currentModel } = await initializeModelAndToken(undefined, this.context);

		if (!currentModel || !currentToken) {
			return;
		}

		if (codeAction.type === 'generate') {
			let altText = await generateAltText(currentModel, currentToken, codeAction.resolvedImagePath, codeAction.isHtml, 'concise', false, codeAction.isUrl);
			if (!altText) {
				return;
			}
			codeAction.edit = new vscode.WorkspaceEdit();
			const edit = new vscode.WorkspaceEdit();
			if (codeAction.isHtml) {
				let additionalCharsToRemove = 0;
				if (!codeAction.currentLine.includes('alt=')) {
					altText = `img alt="${altText}"`;
					additionalCharsToRemove = 3;
				}
				edit.replace(codeAction.document.uri, new vscode.Range(codeAction.range.start.line, codeAction.altTextStartIndex, codeAction.range.start.line, codeAction.altTextStartIndex + additionalCharsToRemove), altText);
			} else {
				const isBoilerplate = codeAction.currentLine.includes('![alt text]');
				if (isBoilerplate) {
					edit.replace(codeAction.document.uri, new vscode.Range(codeAction.range.start.line, codeAction.altTextStartIndex, codeAction.range.start.line, codeAction.altTextStartIndex + 8), altText);
				} else {
					edit.insert(codeAction.document.uri, new vscode.Position(codeAction.range.start.line, codeAction.altTextStartIndex), altText);
				}
			}
			codeAction.edit = edit;
			return codeAction;
		} else if (codeAction.type === 'refine') {
			const altText = await generateAltText(currentModel, currentToken, codeAction.resolvedImagePath, codeAction.isHtml, 'refine', true, codeAction.isUrl);
			if (!altText) {
				return;
			}
			const edit = new vscode.WorkspaceEdit();
			edit.replace(codeAction.document.uri, new vscode.Range(codeAction.range.start.line, codeAction.altTextStartIndex, codeAction.range.start.line, codeAction.altTextStartIndex + codeAction.altTextLength), altText);
			await vscode.workspace.applyEdit(edit);
		}
	}
}

export function isValidUrl(imagePath: string): boolean {
	try {
		new URL(imagePath);
		return true;
	} catch (e) {
		return false;
	}
}
