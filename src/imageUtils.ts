
// matches images in markdown, html, and markdown links when they do not have alt text
const imageRegex = /!\[\s*\]\(([^)]+)\)|<img\s+[^>]*src="([^"]+)"[^>]*>|\[!\[\s*\]\(([^)]+)\)\]\(([^)]+)\)/;

export function parseImagePath(line: string): { imagePath: string, altTextStartIndex: number } | undefined {
	const match = line.match(imageRegex);
	if (!match || match.index === undefined) {
		return;
	}
	let expectedIndex = 1;
	if (match.includes('\<')) {
		expectedIndex = 2;
	} else if (match[0].startsWith('[![]')) {
		expectedIndex = 3;
	}
	const imagePath = match[expectedIndex];
	if (!imagePath) {
		return;
	}
	const altTextStartIndex = match.index + expectedIndex;
	if (!altTextStartIndex) {
		return;
	}
	return { imagePath, altTextStartIndex };
}