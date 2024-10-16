
// matches images in markdown, html, and markdown links when they do not have alt text
const imageRegex = /!\[\s*\]\(([^)]+)\)|<img\s+[^>]*src="([^"]+)"[^>]*>|\[!\[\s*\]\(([^)]+)\)\]\(([^)]+)\)/;

export function parseLine(line: string): { imagePath: string, altTextStartIndex: number } | undefined {
	const match = line.match(imageRegex);
	if (!match || match.index === undefined) {
		return;
	}
	let altTextStartIndex = 1;
	let expectedIndex = 1;
	if (match[0].startsWith('\<')) {
		expectedIndex = 2;
		altTextStartIndex = 1;
	} else if (match[0].startsWith('[![]')) {
		expectedIndex = 3;
		altTextStartIndex = 3;
	}
	const imagePath = match[expectedIndex];
	if (!imagePath) {
		return;
	}
	if (!altTextStartIndex) {
		return;
	}
	return { imagePath, altTextStartIndex };
}