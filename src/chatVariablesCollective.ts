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
					const originalName = 'variable original name'
					const uniqueName = 'variable unique name';
					this._variables.push({ originalName, uniqueName, value: variable.value, range: variable.range });
				}
			}
		}

		return this._variables;
	}

	public *[Symbol.iterator](): IterableIterator<PromptVariable> {
		yield* this._getVariables();
	}

	public hasVariables(): boolean {
		return this._getVariables().length > 0;
	}
}
