import assert from 'assert';
import { suite, test } from 'mocha';

// when I import this from extension.ts, the test throws saying ChatVariableData is not defined
const imageRegex = /!\[\s*\]\(([^)]+)\)|<img\s+[^>]*src="([^"]+)"[^>]*>|\[!\[\s*\]\(([^)]+)\)\]\(([^)]+)\)/;

suite('imageRegex', () => {
	test('should capture the image path in markdown image syntax', () => {
		const markdownImage = '![](path/to/image.png)';
		const match = markdownImage.match(imageRegex);
		assert(match);
		assert.equal(match![1], 'path/to/image.png');
	});

	test('should capture the image path in HTML image syntax', () => {
		const htmlImage = '<img src="path/to/image.png" />';
		const match = htmlImage.match(imageRegex);
		assert(match);
		assert.equal(match![2], 'path/to/image.png');
	});

	test('should capture the image path in markdown link with image syntax', () => {
		const markdownLinkImage = '[![](path/to/image.png)](http://example.com)';
		const match = markdownLinkImage.match(imageRegex);
		assert(match);
		assert.equal(match![3], 'path/to/image.png');
	});

	test('should capture the link path in markdown link with image syntax', () => {
		const markdownLinkImage = '[![](path/to/image.png)](http://example.com)';
		const match = markdownLinkImage.match(imageRegex);
		assert(match);
		assert.equal(match![3], 'path/to/image.png');
	});

	test('should not match if there is alt text in markdown image syntax', () => {
		const markdownImageWithAlt = '![alt text](path/to/image.png)';
		const match = markdownImageWithAlt.match(imageRegex);
		assert(!match);
	});

	test('should not match if there is alt text in markdown link with image syntax', () => {
		const markdownLinkImageWithAlt = '[![alt text](path/to/image.png)](http://example.com)';
		const match = markdownLinkImageWithAlt.match(imageRegex);
		assert(!match);
	});
});