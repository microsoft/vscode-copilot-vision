/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
	AuthenticationProvider,
	AuthenticationProviderAuthenticationSessionsChangeEvent,
	AuthenticationSession,
	Disposable,
	EventEmitter,
	ExtensionContext,
	ThemeIcon,
	Uri,
	env,
	l10n,
	window,
	workspace,
} from 'vscode';
import { ApiKeyDetails, ApiKeySecretStorage } from './secretStorage';
import { getApi } from '../apiFacade';
import { ProviderType } from '../extension';

export abstract class BaseAuth {
	private readonly _disposable: Disposable;
	// private readonly _didChangeSessions = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
	// onDidChangeSessions = this._didChangeSessions.event;

	protected abstract readonly name: string;

	constructor() {
		this._disposable = Disposable.from();
	}

	protected abstract validateKey(key: string): Promise<boolean>;

	async setAPIKey(context: ExtensionContext): Promise<void> {
		const input = window.createInputBox();
		input.totalSteps = 2;
		input.title = l10n.t('{0} Login', this.name);

		// Get API Key
		input.step = 1;
		const placeholderText = l10n.t('Enter your {0} API key', this.name);
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
				if (!input.value || !(await this.validateKey(input.value))) {
					input.validationMessage = l10n.t('Invalid API key');
					input.busy = false;
					input.enabled = true;
					return;
				}
				disposable.dispose();
				resolve(input.value);
			});

			const hideDisposable = input.onDidHide(async () => {
				if (!input.value || !(await this.validateKey(input.value))) {
					disposable.dispose();
					hideDisposable.dispose();
					reject(new Error('Invalid API key'));
				}
			});
		});

		context.secrets.store(this.name, key);
	}

	async deleteKey(sessionId: string): Promise<void> {
		// await this._secrets.delete(sessionId);
	}

	async getKey(id: string, context: ExtensionContext): Promise<string | undefined> {
		const key = await context.secrets.get(id);
		return key;
	}

	dispose() {
		this._disposable.dispose();
	}
}

abstract class ApiAuthValidator extends BaseAuth {
	protected abstract readonly modelType: ProviderType;

	protected async validateKey(key: string): Promise<boolean> {
		try {
			const api = getApi(this.modelType);
			const config = workspace.getConfiguration();
			const model: string | undefined = config.get('copilot.vision.model');
			if (!model) {
				throw new Error('Invalid Model');
			}

			const ChatModel = {
				provider: this.modelType,
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
}

export class OpenAIAuth extends ApiAuthValidator {
	static readonly ID = 'OpenAI';
	static readonly NAME = 'OpenAI GPT';

	protected readonly name = OpenAIAuth.ID;
	protected readonly modelType = ProviderType.OpenAI;
}

export class AnthropicAuth extends ApiAuthValidator {
	static readonly ID = 'Anthropic';
	static readonly NAME = 'Anthropic Claude';

	protected readonly name = AnthropicAuth.NAME;
	protected readonly modelType = ProviderType.Anthropic;
}

export class GeminiAuth extends ApiAuthValidator {
	static readonly ID = 'Gemini';
	static readonly NAME = 'Google Gemini';

	protected readonly name = GeminiAuth.NAME;
	protected readonly modelType = ProviderType.Gemini;
}
