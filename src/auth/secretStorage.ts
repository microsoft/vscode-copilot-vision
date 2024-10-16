/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Event, EventEmitter, ExtensionContext, SecretStorage, SecretStorageChangeEvent } from "vscode";
export interface ApiKeyDetails {
	name: string;
	apiKey: string;
}
export interface ApiKeyDetailsChangedEvent {
	added: ApiKeyDetails[];
	changed: ApiKeyDetails[];
	removed: ApiKeyDetails[]
}
export class ApiKeySecretStorage {
	private _map = new Map<string, string>();
	private readonly _secretStorage: SecretStorage;
	private _onDidChange = new EventEmitter<ApiKeyDetailsChangedEvent>();
	onDidChange: Event<ApiKeyDetailsChangedEvent> = this._onDidChange.event;
	/**
	 *
	 * @param keylistKey The key in the secret storage that will hold the list of keys associated with this instance of BetterTokenStorage
	 * @param context the vscode Context used to register disposables and retreive the vscode.SecretStorage for this instance of VS Code
	 */
	constructor(private _storageKey: string, context: ExtensionContext) {
		this._secretStorage = context.secrets;
		context.subscriptions.push(this._onDidChange);
		context.subscriptions.push(context.secrets.onDidChange((e) => this._handleSecretChange(e)));
	}
	async initialize() {
		const fromSecretStorage = await this._secretStorage.get(this._storageKey);
		if (fromSecretStorage) {
			this._map = new Map(Object.entries(JSON.parse(fromSecretStorage)));
		}
	}
	getAll(): ApiKeyDetails[] {
		return Array.from(this._map.entries()).map(([key, value]) => ({ name: key, apiKey: value }));
	}
	get(key: string): string | undefined {
		return this._map.get(key);
	}
	async set(key: string, value: string): Promise<void> {
		// turn map into a json string
		const map = Object.fromEntries(this._map);
		map[key] = value;
		await this._secretStorage.store(this._storageKey, JSON.stringify(map));
	}
	async delete(key: string): Promise<void> {
		const map = Object.fromEntries(this._map);
		delete map[key];
		await this._secretStorage.store(this._storageKey, JSON.stringify(map));
	}
	private async _handleSecretChange({ key: changedKey }: SecretStorageChangeEvent) {
		if (changedKey !== this._storageKey) {
			return;
		}
		const fromSecretStorage = await this._secretStorage.get(this._storageKey);

		// If the secret storage is empty, we should clear the map
		if (!fromSecretStorage) {
			const all = this.getAll();
			this._map.clear();
			this._onDidChange.fire({ removed: all, added: [], changed: [] });
			return;
		}
		// If the secret storage is not empty, we should compare the new keys to the existing keys
		const newKeys = JSON.parse(fromSecretStorage) as { [key: string]: string };
		const newEvent = { added: new Array<ApiKeyDetails>(), removed: new Array<ApiKeyDetails>(), changed: new Array<ApiKeyDetails>() };
		for (const key in newKeys) {
			if (!this._map.has(key)) {
				newEvent.added.push({ name: key, apiKey: newKeys[key] });
			} else if (this._map.get(key) !== newKeys[key]) {
				newEvent.changed.push({ name: key, apiKey: newKeys[key] });
			}
		}
		for (const key of this._map.keys()) {
			if (!newKeys[key]) {
				newEvent.removed.push({ name: key, apiKey: this._map.get(key)! });
			}
		}

		this._map = new Map(Object.entries(newKeys));
		this._onDidChange.fire(newEvent);
	}
}
