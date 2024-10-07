/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

export interface PromptVariable {
	readonly originalName: string;
	readonly uniqueName: string;
	readonly value: string | vscode.Uri | vscode.Location | vscode.ChatReferenceBinaryData | unknown;
	readonly range?: [start: number, end: number];
}

export class ChatVariablesCollection {

	private _variables: PromptVariable[] | null = null;

	constructor(
		public readonly _source: readonly vscode.ChatPromptReference[]
	) { }

	private _getVariables(): PromptVariable[] {
		if (!this._variables) {
			this._variables = [];
			for (let i = 0; i < this._source.length; i++) {
				const variable = this._source[i];
				// Rewrite the message to use the variable header name
				if (variable.value) {
					const originalName = 'temp name';
					const uniqueName = 'temp name';
					this._variables.push({ originalName, uniqueName, value: variable.value, range: variable.range });
				}
			}
		}
		
		return this._variables;
	}

	public reverse() {
		const sourceCopy = this._source.slice(0);
		sourceCopy.reverse();
		return new ChatVariablesCollection(sourceCopy);
	}

	public find(predicate: (v: PromptVariable) => boolean): PromptVariable | undefined {
		return this._getVariables().find(predicate);
	}

	public *[Symbol.iterator](): IterableIterator<PromptVariable> {
		yield* this._getVariables();
	}

	public substituteVariablesWithReferences(userQuery: string): string {
		const replacements: { start: number; end: number; newText: string }[] = [];
		for (const variable of this._getVariables()) {
			if (variable.range) {
				replacements.push({ start: variable.range[0], end: variable.range[1], newText: `[#${variable.uniqueName}](#${variable.uniqueName}-context)` });
			}
		}
		// sort descending by end
		replacements.sort((a, b) => b.end - a.end);
		// we can now apply them safely in order starting from the end
		for (const replacement of replacements) {
			userQuery = userQuery.slice(0, replacement.start) + replacement.newText + userQuery.slice(replacement.end);
		}
		return userQuery;
	}

	public hasVariables(): boolean {
		return this._getVariables().length > 0;
	}

	// private uniqueFileName(name: string, variables: vscode.ChatPromptReference[]): string {
	// 	const count = variables.filter(v => v.name === name).length;
	// 	return count === 0 ? name : `${name}-${count}`;
	// }
}
