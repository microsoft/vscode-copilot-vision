// @ts-check
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const headersPlugin = require('eslint-plugin-headers');

module.exports = [
	{
		ignores: ['out/**', 'dist/**', '**/*.d.ts'],
	},
	{
		files: ['src/**/*.ts'],
		plugins: {
			'@typescript-eslint': tsPlugin,
			'headers': headersPlugin,
		},
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 6,
				sourceType: 'module',
			},
		},
		rules: {
			'@typescript-eslint/naming-convention': [
				'warn',
				{
					selector: 'import',
					format: ['camelCase', 'PascalCase'],
				},
			],
			'headers/header-format': [
				'error',
				{
					source: 'string',
					style: 'jsdoc',
					blockPrefix: '---------------------------------------------------------------------------------------------\n',
					blockSuffix: '\n *--------------------------------------------------------------------------------------------',
					linePrefix: ' *  ',
					content: 'Copyright (c) Microsoft Corporation. All rights reserved.\nLicensed under the MIT License. See LICENSE in the project root for license information.',
				},
			],
			'curly': 'warn',
			'eqeqeq': 'warn',
			'no-throw-literal': 'warn',
		},
	},
];
