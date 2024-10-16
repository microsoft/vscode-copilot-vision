
import * as vscode from 'vscode';
import { getApi } from './apiFacade';
import { ChatModel } from './extension';

// matches images in markdown, html, and markdown links when they do not have alt text
const imageRegex = /!\[\s*\]\(([^)]+)\)|<img\s+[^>]*src="([^"]+)"[^>]*>|\[!\[\s*\]\(([^)]+)\)\]\(([^)]+)\)/;
// matches images in markdown, html, and markdown links when they do have alt text
export const imageRegexAltTextPresent = /!\[([^\]]*)\]\(([^)]+)\)|<img\s+[^>]*alt="([^"]*)"\s+[^>]*src="([^"]+)"[^>]*>|<img\s+[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>|\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)/;
export function extractImageInfo(line: string, refineResult?: boolean): { imagePath: string, altTextStartIndex: number, isHTML: boolean, altTextLength: number } | undefined {
	const match = refineResult ? line.match(imageRegexAltTextPresent) : line.match(imageRegex);
	if (!match || match.index === undefined) {
		return;
	}
	let altTextStartIndex = refineResult ? 2 : 1;
	let imagePathIndex = 1;
	let isHTML = false;
	let altTextMatchIndex = 1;

	if (match[0].startsWith('<')) {
		imagePathIndex = 2;
		altTextStartIndex = 1;
		isHTML = true;
		if (refineResult) {
			const srcIndex = match[0].indexOf('src="');
			const altIndex = match[0].indexOf('alt="');
			if (srcIndex > altIndex) {
				altTextMatchIndex = 3;
				imagePathIndex = 4;
			} else {
				altTextMatchIndex = 6;
				imagePathIndex = 5;
			}
		}
	} else if (match[0].startsWith('[![]')) {
		imagePathIndex = 3;
		altTextStartIndex = 3;
		if (refineResult) {
			altTextMatchIndex = 7;
			imagePathIndex = 8;
		}
	}
	const imagePath = match[imagePathIndex];
	if (!imagePath) {
		return;
	}
	if (!altTextStartIndex) {
		return;
	}
	let altText = '';
	if (refineResult && match.length > altTextMatchIndex) {
		altText = match[altTextMatchIndex];
	}
	return { imagePath, altTextStartIndex, isHTML, altTextLength: altText.length };
}

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


export async function generateAltText(model: ChatModel, apiKey: string, imagePath: string, isHtml: boolean, type: 'verbose' | 'concise' | 'query'): Promise<string | undefined> {
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

		if (isHtml) {
			return `img alt="${altText}"`;
		}
		return altText;
	} catch (err: unknown) {
		return;
	}
}