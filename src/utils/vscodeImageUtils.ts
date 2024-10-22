/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getApi } from '../apiFacade';
import { ChatModel } from '../extension';

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


export async function generateAltText(model: ChatModel, apiKey: string, imagePath: string, isHtml: boolean, type: 'concise' | 'refine', refineResult: boolean): Promise<string | undefined> {
	const uri = vscode.Uri.file(imagePath);
	const result = await getBufferAndMimeTypeFromUri(uri);
	if (!result) {
		return;
	}
	const { buffer, mimeType } = result;
	let query = 'Generate concise alt text for this image, focusing on key elements while omitting unnecessary visual details, such as colors. Do not include single or double quotes in the alt text.';
	if (type === 'refine') {
		const userQuery = await vscode.window.showInputBox({
			placeHolder: '(Optional) Specify information about the alt text you want for the image.',
		});

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
