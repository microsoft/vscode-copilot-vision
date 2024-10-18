/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	Disposable,
	ExtensionContext,
	l10n,
	window,
	workspace,
} from 'vscode';
import { getApi } from '../apiFacade';
import { ProviderType } from '../extension';

export class BaseAuth {
	private readonly _disposable: Disposable;

	constructor() {
		this._disposable = new Disposable(() => {});
	}

	async validateKey(key: string, providerType: ProviderType): Promise<boolean> {
		try {
			const api = getApi(providerType);
			const config = workspace.getConfiguration();
			const model = config.get<string>('copilot.vision.model');
			
			if (!model) {
				throw new Error('Invalid Model');
			}

			const ChatModel = {
				provider: providerType,
				model
			};

			const result = await api.create(key, 'test', ChatModel, [], 'image/png');
			if (!result) {
				throw new Error('Invalid API key');
			}
			return true;
		} catch (e) {
			return false;
		}
	}

	async setAPIKey(name: string, context: ExtensionContext): Promise<void> {
		const input = window.createInputBox();
		input.title = l10n.t('Set {0} API Key', name);

		// Get API Key
		const placeholderText = l10n.t('Enter your {0} API key', name);
		input.placeholder = placeholderText;
		input.ignoreFocusOut = true;
		input.onDidChangeValue((value) => {
			input.validationMessage = undefined;
		});

		input.show();
		const key: string = await new Promise((resolve, reject) => {
			const disposable = input.onDidAccept(async () => {
				input.busy = true;
				input.enabled = false;
				if (!input.value || !(await this.validateKey(input.value, name as ProviderType))) {
					input.validationMessage = l10n.t('Invalid API key');
					input.busy = false;
					input.enabled = true;
					return;
				}
				resolve(input.value);
				disposable.dispose();
				input.hide();
			});

			const hideDisposable = input.onDidHide(async () => {
				if (!input.value || !(await this.validateKey(input.value, name as ProviderType))) {
					disposable.dispose();
					hideDisposable.dispose();
					reject(new Error('API key was not set.'));
				}
			});
		});

		context.secrets.store(name, key);
	}

	async deleteKey(name: string, context: ExtensionContext): Promise<void> {
		await context.secrets.delete(name);
	}

	async getKey(name: string, context: ExtensionContext): Promise<string | undefined> {
		const key = await context.secrets.get(name);
		return key;
	}

	dispose() {
		this._disposable.dispose();
	}
}
