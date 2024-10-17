
import * as vscode from 'vscode';
import path from 'path';
import { extractImageAttributes } from './imageUtils';
import { generateAltText } from './vscodeImageUtils';
import { ChatModel, initializeModelAndToken } from './extension';

interface ImageCodeAction extends vscode.CodeAction {
	document: vscode.TextDocument;
	range: vscode.Range;
	resolvedImagePath: string;
	currentLine: string;
	altTextStartIndex: number;
	isHtml: boolean;
}

export class AltTextQuickFixProvider implements vscode.CodeActionProvider<ImageCodeAction> {
	public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
	private _cachedToken: string | undefined;
	private _cachedModel: ChatModel | undefined;
	async provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<ImageCodeAction[] | undefined> {
		const currentLine = document.lineAt(range.start.line).text;
		const parsed = extractImageAttributes(currentLine);

		if (!parsed) {
			return;
		}

		const resolvedImagePath = path.resolve(path.dirname(document.uri.fsPath), parsed.imagePath);
		return [{
			title: 'Generate Alt Text',
			kind: vscode.CodeActionKind.QuickFix,
			range,
			document,
			resolvedImagePath,
			altTextStartIndex: parsed.altTextStartIndex,
			isHtml: parsed.isHTML,
			currentLine
		}];
	}

	async resolveCodeAction(codeAction: ImageCodeAction, token: vscode.CancellationToken): Promise<ImageCodeAction | undefined> {
		if (token.isCancellationRequested) {
			return;
		}
		if (!this._cachedToken || !this._cachedModel) {
			const { cachedToken, cachedModel } = await initializeModelAndToken();
			this._cachedToken = cachedToken;
			this._cachedModel = cachedModel;
		}
		if (!this._cachedModel || !this._cachedToken) {
			return;
		}
		let altText = await generateAltText(this._cachedModel, this._cachedToken, codeAction.resolvedImagePath, codeAction.isHtml, 'concise', false);
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
