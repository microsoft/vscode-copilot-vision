
import * as vscode from 'vscode';

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