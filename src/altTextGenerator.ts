import * as vscode from 'vscode';

export class AltTextGenerator implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	async provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.CodeAction[] | undefined> {
		const text = document.getText(range);
		const match = text.match(/!\[\]\(([^)]+)\)/);
		if (!match) {
			return;
		}

		const imagePath = match[1]; // Extract the relative path from the parentheses

		const altText = await this.generateAltText(imagePath);

		const fix = new vscode.CodeAction('Generate alt text', vscode.CodeActionKind.QuickFix);
		fix.edit = new vscode.WorkspaceEdit();
		fix.edit.replace(document.uri, range, `![alt text](${match[1]})`);
		return [fix];
	}

	async generateAltText(imagePath: string): Promise<string> {
		const uri = vscode.Uri.file(imagePath);
		const fileExtension = uri.path.split('.').pop()?.toLowerCase();
		const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff'];

		function getMimeType(ext: string) {
			if (ext === 'jpg') {
				return 'image/jpeg';
			}
			return `image/${ext}`;
		}

		if (fileExtension && imageExtensions.includes(fileExtension)) {
			const buffer = Buffer.from(await vscode.workspace.fs.readFile(uri));
			const mimeType = getMimeType(fileExtension)
		} else {
			return 'alt text';
		}
		return 'alt text';
	}
}