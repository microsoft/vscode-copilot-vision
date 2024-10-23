/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function extractImageAttributes(line: string, refineExisting?: boolean): { imagePath: string, altTextStartIndex: number, isHTML: boolean, altTextLength: number } | undefined {
	// Regex to match markdown image syntax ![alt text](<?image_path>?)
	const markdownImageRegex = /!\[([^\]]*)\]\(<?([^)<>]+?)>?\)/;
	// Updated regex to match HTML image syntax with alt and src in any order
	const htmlImageRegex = /<img\s+(?:alt=["']([^"']*)["']\s*)?src=["']([^"']+)["'](?:\s*alt=["']([^"']*)["'])?/;

	let match;
	let imagePath = '';
	let altText = '';
	let altTextStartIndex = -1;
	let altTextLength = 0;
	let isHTML = false;

	// Check if it's a markdown image
	if ((match = markdownImageRegex.exec(line)) !== null) {
		imagePath = match[2];
		altText = match[1];
		altTextStartIndex = match.index + 2; // start after `![`
		altTextLength = altText.length;
		isHTML = false;

		// If refineExisting is true, ensure altText already exists
		if (refineExisting && (!altText || altText === 'alt text')) {
			return undefined;
		}

		// If refineExisting is false, ensure altText does not exist
		if (!refineExisting && (altText && altText !== 'alt text')) {
			return undefined;
		}

		return { imagePath, altTextStartIndex, isHTML, altTextLength };
	}

	// Check if it's an HTML image
	if ((match = htmlImageRegex.exec(line)) !== null) {
		imagePath = match[2]; // The src attribute is always the second group
		altText = match[1] || match[3] || ''; // alt text can be in either the first or third group, depending on order
		isHTML = true;

		// If refineExisting is true, ensure altText already exists
		if (refineExisting && !altText) {
			return;
		}

		// If refineExisting is false, ensure altText does not exist
		if (!refineExisting && altText) {
			return; // Return undefined if alt text is already present when refineExisting is false
		}

		const exactAltEmptyRegex = /alt=["']{2}/;
		if (!refineExisting && line.match(exactAltEmptyRegex)) {
			const altEmptyRegexAtStart = /<img alt=["']{2}/;
			if (altEmptyRegexAtStart.test(line)) {
				altTextStartIndex = match.index + 10; // Start right after <img alt=""
				altTextLength = 0;
				return { imagePath, altTextStartIndex, isHTML, altTextLength };
			} else {
				altTextStartIndex = match.index + match[0].indexOf(`alt="${altText}"`) + 5;
				altTextLength = altText.length;
				return { imagePath, altTextStartIndex, isHTML, altTextLength };
			}
		}

		// Calculate where the altTextStartIndex should be if the alt is missing
		if (!altText) {
			// If alt text is missing, the alt should be inserted right after the opening <img tag
			altTextStartIndex = match.index + 1; // Start right after the opening `<img`
		} else {
			// Alt text exists, find the actual start index of alt attribute
			if (match[1]) {
				// If alt comes before src, the altTextStartIndex is immediately after <img
				altTextStartIndex = match.index + 10; // Right after <img alt="
			} else if (match[3]) {
				// If alt comes after src, calculate its position
				altTextStartIndex = match.index + match[0].indexOf(`alt="${altText}"`) + 5;
			}
		}

		altTextLength = altText.length;

		return { imagePath, altTextStartIndex, isHTML, altTextLength };
	}

	// If no match is found, return undefined
	return undefined;
}
