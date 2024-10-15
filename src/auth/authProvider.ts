/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
	AuthenticationProvider,
	AuthenticationProviderAuthenticationSessionsChangeEvent,
	AuthenticationSession,
	EventEmitter,
	ThemeIcon,
	Uri,
	env,
	l10n,
	window,
	workspace,
} from 'vscode';
import { BetterTokenStorage } from './secretStorage';
import { getApi } from '../apiFacade';
import { ModelType } from '../extension';

export abstract class BaseAuthProvider implements AuthenticationProvider {
	_didChangeSessions =
		new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
	onDidChangeSessions = this._didChangeSessions.event;

	protected abstract readonly name: string;
	// protected abstract readonly createKeyUrl: string | undefined;

	constructor(private readonly _secrets: BetterTokenStorage<AuthenticationSession>) { }

	protected abstract validateKey(key: string): Promise<boolean>;

	async getSessions(_scopes?: string[]): Promise<AuthenticationSession[]> {
		try {
			return await this._secrets.getAll();
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

		const id = Math.random().toString(36).slice(2);
		const authSession: AuthenticationSession = {
			accessToken: key,
			id,
			account: {
				label: name,
				id: name,
			},
			scopes: [],
		};

		// Store and return the session
		await this._secrets.store(id, authSession);
		this._didChangeSessions.fire({ added: [authSession], removed: [], changed: [] });
		return authSession;
	}

	async removeSession(sessionId: string): Promise<void> {
		const removed = await this._secrets.get(sessionId);
		await this._secrets.delete(sessionId);
		this._didChangeSessions.fire({ added: [], removed: removed ? [removed] : [], changed: [] });
	}
}

export class AnthropicAuthProvider extends BaseAuthProvider {
	static readonly ID = 'bing';
	static readonly NAME = 'Bing';

	protected readonly name = AnthropicAuthProvider.NAME;

	protected async validateKey(key: string): Promise<boolean> {
		try {
			const api = getApi(ModelType.Anthropic);
			const config = workspace.getConfiguration();
			const model: string | undefined = config.get('copilot.vision.model');
			if (!model) {
				return false;
			}

			const ChatModel = {
				deployment: model,
				type: ModelType.Anthropic,
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
