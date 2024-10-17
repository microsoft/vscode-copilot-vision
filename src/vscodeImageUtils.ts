
import * as vscode from 'vscode';
import { getApi } from './apiFacade';
import { ChatModel } from './extension';

const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff'];
export async function getBufferAndMimeTypeFromUri(uri: vscode.Uri): Promise<{ buffer: Buffer, mimeType: string } | undefined> {
	const fileExtension = uri.path.split('.').pop()?.toLowerCase();
	if (!fileExtension || !imageExtensions.includes(fileExtension)) {
		return;
	}

	const buffer = Buffer.from(await vscode.workspace.fs.readFile(uri));
	const mimeType = getMimeType(fileExtension)
	return { buffer, mimeType };
}

function getMimeType(ext: string) {
	if (ext === 'jpg') {
		return 'image/jpeg';
	}
	return `image/${ext}`;
}


export async function generateAltText(model: ChatModel, apiKey: string, imagePath: string, isHtml: boolean, type: 'verbose' | 'concise' | 'query', refineResult: boolean): Promise<string | undefined> {
	const uri = vscode.Uri.file(imagePath);
	const result = await getBufferAndMimeTypeFromUri(uri);
	if (!result) {
		return;
	}
	const { buffer, mimeType } = result;
	let query = (type === 'concise' ? 'Generate concise alt text for this image.' : 'Generate alt text for this image.') + 'Focus on essential elements and avoid unnecessary visual details like colors. Never include single or double quotes in the alt text.';
	if (type === 'query') {
		const userQuery = await vscode.window.showInputBox({
			placeHolder: 'Enter additional details for the alt text generation',
			prompt: 'Specify more information about the alt text you want for the image.'
		});

		if (!userQuery) {
			return;
		}

		query = `${query} ${userQuery}`;
	}
	try {
		const api = getApi(model.provider);
		const altText = (await api.create(
			apiKey,
			query,
			model,
			[buffer],
			mimeType)).join(' ');

		return altText;
	} catch (err: unknown) {
		return;
	}
}