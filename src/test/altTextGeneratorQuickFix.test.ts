import assert from 'assert';
import { suite, test } from 'mocha';
import { parseLine } from '../imageUtils';

suite('imageRegex', () => {
	test('should capture the image path in markdown image syntax', () => {
		const markdownImage = '![](path/to/image.png)';
		const match = parseLine(markdownImage);
		assert(match);
		assert.equal(match.imagePath, 'path/to/image.png');
	});

	test('should capture the image path in HTML image syntax', () => {
		const htmlImage = '<img src="path/to/image.png" />';
		const match = parseLine(htmlImage);
		assert(match);
		assert.equal(match.imagePath, 'path/to/image.png');
		assert.equal(match.altTextStartIndex, 1);
		assert.equal(match.isHTML, true);
	});

	test('should capture the image path in markdown link with image syntax', () => {
		const markdownLinkImage = '[![](path/to/image.png)](http://example.com)';
		const match = parseLine(markdownLinkImage);
		assert(match);
		assert.equal(match.imagePath, 'path/to/image.png');
		assert.equal(match.altTextStartIndex, 3);
	});

	test('should not match if there is alt text in markdown image syntax', () => {
		const markdownImageWithAlt = '![alt text](path/to/image.png)';
		const match = parseLine(markdownImageWithAlt);
		assert(!match);
	});

	test('should not match if there is alt text in markdown link with image syntax', () => {
		const markdownLinkImageWithAlt = '[![alt text](path/to/image.png)](http://example.com)';
		const match = parseLine(markdownLinkImageWithAlt)
		assert(!match);
	});
});