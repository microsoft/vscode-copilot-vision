
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import path from 'path';
import { extractImageAttributes } from './utils/imageUtils';
import { generateAltText } from './utils/vscodeImageUtils';
import { initializeModelAndToken } from './extension';
import { extractImageAttributes2 } from './imageUtils';

interface ImageCodeAction extends vscode.CodeAction {
	document: vscode.TextDocument;
	range: vscode.Range;
	resolvedImagePath: string;
	currentLine: string;
	altTextStartIndex: number;
	isHtml: boolean;
	isAi: boolean;
}


export class AltTextQuickFixProvider implements vscode.CodeActionProvider<ImageCodeAction> {
	private context: vscode.ExtensionContext;
	private diagnosticCollection: vscode.DiagnosticCollection;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection('altTextDiagnostics');
		context.subscriptions.push(this.diagnosticCollection);
	}

	public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

	
	async provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<ImageCodeAction[] | undefined> {
		const currentLine = document.lineAt(range.start.line).text;
		const parsed = extractImageAttributes(currentLine);
		const parsed2 = extractImageAttributes2(currentLine);

		if (!parsed || !parsed2) {
			return;
		}

		const resolvedImagePath = path.resolve(path.dirname(document.uri.fsPath), parsed.imagePath);
		const tempRange = new vscode.Range(range.start.line, parsed2.range.start, range.start.line, parsed2.range.end);

		// Add diagnostic if alt text is missing
		if (parsed.altTextLength === 0) {
			const altTextRange = new vscode.Range(
				range.start.line,
				parsed2.range.start,
				range.start.line,
				parsed2.range.end
			);

			const diagnostic = new vscode.Diagnostic(
				altTextRange,
				'Alt text is missing for the image.',
				vscode.DiagnosticSeverity.Warning
			);

			this.diagnosticCollection.set(document.uri, [diagnostic]);
		} else {
			this.diagnosticCollection.delete(document.uri);
		}

		const diagnostic = new vscode.Diagnostic(
			tempRange,
			'Alt text is missing for the image.',
			vscode.DiagnosticSeverity.Warning
		);

		return [{
			title: 'Generate Alt Text',
			kind: vscode.CodeActionKind.QuickFix,
			range,
			document,
			resolvedImagePath,
			altTextStartIndex: parsed.altTextStartIndex,
			isHtml: parsed.isHTML,
			currentLine,
			isAi: true
		}];
	}

	async resolveCodeAction(codeAction: ImageCodeAction, token: vscode.CancellationToken): Promise<ImageCodeAction | undefined> {
		if (token.isCancellationRequested) {
			return;
		}

		const { currentToken, currentModel } = await initializeModelAndToken(undefined, this.context);

		if (!currentModel || !currentToken) {
			return;
		}
		let altText = await generateAltText(currentModel, currentToken, codeAction.resolvedImagePath, codeAction.isHtml, 'concise', false);
		if (!altText) {
			return;
		}
		codeAction.edit = new vscode.WorkspaceEdit();
		const edit = new vscode.WorkspaceEdit();
		if (codeAction.isHtml) {
			let addedTagIndex = 0;
			if (!codeAction.currentLine.includes('alt=')) {
				altText = `img alt="${altText}"`;
				addedTagIndex = 3;
			}
			edit.replace(codeAction.document.uri, new vscode.Range(codeAction.range.start.line, codeAction.altTextStartIndex, codeAction.range.start.line, codeAction.altTextStartIndex + addedTagIndex), altText);
		} else {
			edit.insert(codeAction.document.uri, new vscode.Position(codeAction.range.start.line, codeAction.altTextStartIndex), altText);
		}
		codeAction.edit = edit;
		return codeAction;
	}
}
