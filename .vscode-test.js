import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	tests: [
		{
			label: 'unitTests',
			files: ['dist/test/**/*.test.js'],
			version: 'insiders',
			workspaceFolder: '<absolute-path-to-your-workspace>',
			mocha: {
				ui: 'bdd',
				timeout: 20000,
				color: true
			}
		}
	],
	coverage: {
		output: 'dist/coverage',
		reporter: ['text-summary', 'html', 'markdown']
	}
});
