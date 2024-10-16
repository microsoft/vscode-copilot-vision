import assert from 'assert';
import { extractImageInfo } from '../imageUtils';
import { describe, it } from 'node:test';

describe('imageRegex', () => {
	it('should capture the image path in markdown image syntax', () => {
		const markdownImage = '![](path/to/image.png)';
		const match = extractImageInfo(markdownImage);
		assert(match);
		assert.equal(match.imagePath, 'path/to/image.png');
	});

	it('should capture the image path in HTML image syntax', () => {
		const htmlImage = '<img src="path/to/image.png" />';
		const match = extractImageInfo(htmlImage);
		assert(match);
		assert.equal(match.imagePath, 'path/to/image.png');
		assert.equal(match.altTextStartIndex, 1);
		assert.equal(match.isHTML, true);
	});

	it('should capture the image path in markdown link with image syntax', () => {
		const markdownLinkImage = '[![](path/to/image.png)](http://example.com)';
		const match = extractImageInfo(markdownLinkImage);
		assert(match);
		assert.equal(match.imagePath, 'path/to/image.png');
		assert.equal(match.altTextStartIndex, 3);
	});

	it('should not match if there is alt text in markdown image syntax', () => {
		const markdownImageWithAlt = '![alt text](path/to/image.png)';
		const match = extractImageInfo(markdownImageWithAlt);
		assert(!match);
	});

	it('should not match if there is alt text in markdown link with image syntax', () => {
		const markdownLinkImageWithAlt = '[![alt text](path/to/image.png)](http://example.com)';
		const match = extractImageInfo(markdownLinkImageWithAlt)
		assert(!match);
	});
});