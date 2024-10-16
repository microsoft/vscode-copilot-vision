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
	ThemeIcon,
	Uri,
	env,
	l10n,
	window,
	workspace,
} from 'vscode';
import { ApiKeyDetails, ApiKeySecretStorage } from './secretStorage';
import { getApi } from '../apiFacade';
import { ModelType } from '../extension';

export abstract class BaseAuthProvider implements AuthenticationProvider {
	private readonly _disposable: Disposable;
	private readonly _didChangeSessions = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
	onDidChangeSessions = this._didChangeSessions.event;

	protected abstract readonly name: string;

	constructor(private readonly _secrets: ApiKeySecretStorage) {
		this._disposable = Disposable.from(
			this._didChangeSessions,
			_secrets.onDidChange((e) => this._didChangeSessions.fire({
				added: e.added.map((a) => this._toAuthenticationSession(a)),
				removed: e.removed.map((a) => this._toAuthenticationSession(a)),
				changed: e.changed.map((a) => this._toAuthenticationSession(a))
			}))
		);
	}

	protected abstract validateKey(key: string): Promise<boolean>;

	async getSessions(_scopes?: string[]): Promise<AuthenticationSession[]> {
		try {
			return this._secrets.getAll().map((a) => this._toAuthenticationSession(a));
		} catch (e) {
			console.error(e);
			return [];
		}
	}

	async createSession(_scopes: string[]): Promise<AuthenticationSession> {
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

		// Get a name for the session
		input.buttons = [];
		input.value = '';
		input.step = 2;
		input.placeholder = l10n.t('Enter a name for this account');
		input.busy = false;
		input.enabled = true;
		const name: string = await new Promise((resolve, reject) => {
			input.onDidAccept(() => {
				input.dispose();
				resolve(input.value);
			});
		});

		const authSession: AuthenticationSession = {
			accessToken: key,
			id: name,
			account: {
				label: name,
				id: name,
			},
			scopes: [],
		};

		// Store and return the session
		await this._secrets.set(name, key);
		return authSession;
	}

	async removeSession(sessionId: string): Promise<void> {
		await this._secrets.delete(sessionId);
	}

	private _toAuthenticationSession(details: ApiKeyDetails): AuthenticationSession {
		return {
			accessToken: details.apiKey,
			id: details.name,
			account: {
				label: details.name,
				id: details.name,
			},
			scopes: [],
		};
	}

	dispose() {
		this._disposable.dispose();
	}
}
abstract class ApiAuthProvider extends BaseAuthProvider {
	protected abstract readonly modelType: ModelType;

	protected async validateKey(key: string): Promise<boolean> {
		try {
			const api = getApi(this.modelType);
			const config = workspace.getConfiguration();
			const model: string | undefined = config.get('copilot.vision.deployment');
			if (!model) {
				throw new Error('Invalid Model');
			}

			const ChatModel = {
				deployment: model,
				type: this.modelType,
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

export class OpenAIAuthProvider extends ApiAuthProvider {
	static readonly ID = 'OpenAI';
	static readonly NAME = 'OpenAI GPT';

	protected readonly name = OpenAIAuthProvider.ID;
	protected readonly modelType = ModelType.OpenAI;
}

export class AnthropicAuthProvider extends ApiAuthProvider {
	static readonly ID = 'Anthropic';
	static readonly NAME = 'Anthropic Claude';

	protected readonly name = AnthropicAuthProvider.NAME;
	protected readonly modelType = ModelType.Anthropic;
}

export class GeminiAuthProvider extends ApiAuthProvider {
	static readonly ID = 'Gemini';
	static readonly NAME = 'Google Gemini';

	protected readonly name = GeminiAuthProvider.NAME;
	protected readonly modelType = ModelType.Gemini;
}
