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
	WorkspaceConfiguration,
	type InputBox,
} from 'vscode';
import type { ApiFacade } from '../apiFacade';
import { getApi } from '../apiFacade';
import { ProviderType, type ChatModel } from '../extension';

export class BaseAuth {
	private readonly _disposable: Disposable;

	constructor() {
		this._disposable = new Disposable((): void => {});
	}

	async validateKey(key: string, inputModel?: string): Promise<boolean> {
		try {
			const config: WorkspaceConfiguration = workspace.getConfiguration();
			const model: string | undefined = config.get<string>('copilot.vision.model');
			const provider: ProviderType | undefined = config.get<ProviderType>('copilot.vision.provider');
			const baseUrl: string | undefined = config.get<string>('copilot.vision.baseUrl');
		
			if (!model || !provider) {
				throw new Error('Invalid Model');
			}

			const api: ApiFacade = getApi(provider);

			const ChatModel = <ChatModel>{
				baseUrl,
				provider,
				model: inputModel || model,
			};

			const result: string[] = await api.create(key, 'test', ChatModel, [], 'image/png');
			if (!result) {
				throw new Error('Invalid API key');
			}
			return true;
		} catch (e) {
			return false;
		}
	}

	async setAPIKey(name: string, context: ExtensionContext): Promise<void> {
		const input: InputBox = window.createInputBox();
		input.title = l10n.t('Set {0} API Key', name);

		// Get API Key
		const placeholderText: string = l10n.t('Enter your {0} API key', name);
		input.placeholder = placeholderText;
		input.ignoreFocusOut = true;
		input.onDidChangeValue((value: string): void => {
			input.validationMessage = undefined;
		});

		input.show();
		try {
			const key: string = await new Promise((resolve: (value: string) => void, reject: (reason?: any) => void): void => {
				const disposable = input.onDidAccept(async (): Promise<void> => {
					input.busy = true;
					input.enabled = false;
					if (!input.value || !(await this.validateKey(input.value))) {
						input.validationMessage = l10n.t('Invalid API key');
						input.busy = false;
						input.enabled = true;
						return;
					}
					resolve(input.value);
					disposable.dispose();
					input.hide();
				});

				const hideDisposable: Disposable = input.onDidHide(async (): Promise<void> => {
					if (!input.value || !(await this.validateKey(input.value))) {
						disposable.dispose();
						hideDisposable.dispose();
						reject(new Error('API key is not set.'));
					}
				});
			});
			
			context.secrets.store(name, key);
		} catch (e: any) {
			console.error(e);
		}
	}

	async deleteKey(name: string, context: ExtensionContext): Promise<void> {
		await context.secrets.delete(name);
	}

	async getKey(name: string, context: ExtensionContext): Promise<string | undefined> {
		const key: string | undefined = await context.secrets.get(name);
		return key;
	}

	dispose(): void {
		this._disposable.dispose();
	}
}
