/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dotenv from 'dotenv';
import * as vscode from 'vscode';
import { getBufferAndMimeTypeFromUri } from './utils/vscodeImageUtils';
import { AltTextQuickFixProvider } from './altTextQuickFixProvider';
import { getApi } from './apiFacade';
import { BaseAuth } from './auth/validationAuth';

dotenv.config();

const VISION_PARTICIPANT_ID = 'chat-sample.vision';

export enum ProviderType {
	Anthropic = 'Anthropic',
	OpenAI = 'OpenAI',
	Gemini = 'Gemini',
	AzureOpenAI = 'AzureOpenAI'
}

export interface ChatModel {
	provider: ProviderType;
	model: string;
}

interface IVisionChatResult extends vscode.ChatResult {
	metadata: {
		command: string;
	}
}

const troubleshootQuery = "troubleshoot my VS Code setup, as pictured.";

export async function activate(context: vscode.ExtensionContext) {
	subscribe(context);

	const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, contexts: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<IVisionChatResult> => {

		let { currentModel, currentToken } = await initializeModelAndToken(stream, context);

		if (!currentModel || !currentToken) {
			throw new Error('Something went wrong in the auth flow.');
		}

		stream.progress(vscode.l10n.t(`Generating response from ${currentModel?.provider}...`));

		const chatVariables = request.references;
		if (chatVariables.length === 0) {
			stream.markdown(vscode.l10n.t('I need a picture to generate a response.'));
			return { metadata: { command: '' } };
		}

		let base64Strings: Buffer[] = [];
		let mimeType: string | undefined;

		for (const reference of chatVariables) {
			// URI in cases of drag and drop or from file already in the workspace
			if (reference.value instanceof vscode.Uri) {
				const result = await getBufferAndMimeTypeFromUri(reference.value);
				if (!result) {
					stream.markdown(vscode.l10n.t(`The file is not an image.`));
					return { metadata: { command: '' } };
				}
				mimeType = result.mimeType;
				base64Strings.push(result.buffer);
				// ChatReferenceBinaryData in cases of copy and paste (or from quick pick)
			} else if (reference.value instanceof vscode.ChatReferenceBinaryData) {
				mimeType = reference.value.mimeType;
				base64Strings.push(Buffer.from(await reference.value.data()));
			}
		}

		if (!mimeType) {
			throw new Error('No image type was found from the attachment.');
		}

		try {
			const api = getApi(currentModel.provider);
			let prompt = request.prompt;
			if (prompt === troubleshootQuery) {
				// HACK: To do, check screen reader optimized vs beginner
				prompt += ' Tailor the response to screen reader users.';
			}
			const result = await api.create(currentToken, prompt, currentModel, base64Strings, mimeType);
			for (const message of result) {
				stream.markdown(vscode.l10n.t(message));
			}

		} catch (err: unknown) {
			// Invalidate token if it's a 401 error
			if (typeof err === 'object' && err && 'status' in err && err.status === 401) {
				currentToken = undefined;
			}
			handleError(logger, err, stream);
		}

		return { metadata: { command: '' } };
	};

	const vision = vscode.chat.createChatParticipant(VISION_PARTICIPANT_ID, handler);
	vision.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets/vision-eye-logo.png');

	const logger = vscode.env.createTelemetryLogger({
		sendEventData(eventName, data) {
			// Capture event telemetry
			console.log(`Event: ${eventName}`);
			console.log(`Data: ${JSON.stringify(data)}`);
		},
		sendErrorData(error, data) {
			// Capture error telemetry
			console.error(`Error: ${error}`);
			console.error(`Data: ${JSON.stringify(data)}`);
		}
	});

	context.subscriptions.push(vision.onDidReceiveFeedback((feedback: vscode.ChatResultFeedback) => {
		// Log chat result feedback to be able to compute the success matric of the participant
		// unhelpful / totalRequests is a good success metric
		logger.logUsage('chatResultFeedback', {
			kind: feedback.kind
		});
	}));
}

function handleError(logger: vscode.TelemetryLogger, err: any, stream: vscode.ChatResponseStream): void {
	// making the chat request might fail because
	// - model does not exist
	// - user consent not given
	// - quote limits exceeded
	logger.logError(err);

	if (err instanceof vscode.LanguageModelError) {
		console.log(err.message, err.code, err.cause);
		if (err.cause instanceof Error && err.cause.message.includes('off_topic')) {
			stream.markdown(vscode.l10n.t('I\'m sorry, I can only explain computer science concepts.'));
		}
	} else {
		// re-throw other errors so they show up in the UI
		throw err;
	}
}


// Helper Functions
export async function initializeModelAndToken(stream?: vscode.ChatResponseStream, context?: vscode.ExtensionContext): Promise<{ currentToken: string | undefined, currentModel: ChatModel | undefined }> {
	// Default to Azure Open AI, only use a different model if one is selected explicitly
	// through the model picker command
	const chatModel = getModel();

	let contextToken: string | undefined;

	stream?.progress(`Setting ${chatModel.provider} API key...`);
	
	const key = await context?.secrets.get(chatModel.provider as ProviderType);
	if (key) {
		contextToken = key;
	} else {
		// Wait for the API key to be set
		await vscode.commands.executeCommand('copilot.vision.setApiKey');
		contextToken = await context?.secrets.get(chatModel.provider as ProviderType);
	}

	if (!contextToken) {
		throw new Error('API key was not properly set');
	}

	return { currentToken: contextToken, currentModel: chatModel };
}

export function getModel(): ChatModel {
	const config = vscode.workspace.getConfiguration();
	const currentModel = config.get<string>('copilot.vision.model');
	const currentProvider = config.get<ProviderType>('copilot.vision.provider');
	return { provider: currentProvider || ProviderType.OpenAI, model: currentModel || 'gpt-4o' };
}

export function subscribe(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('copilot.vision.setApiKey', async () => {
		const auth = new BaseAuth();
		const provider = getModel().provider;
		if (provider) {
			await auth.setAPIKey(provider, context);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('copilot.vision.deleteApiKey', async () => {
		const auth = new BaseAuth();
		const provider = getModel().provider;
		if (provider) {
			await auth.deleteKey(provider, context);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('copilot.vision.selectProviderAndModel', async () => {
		const providers = [
			{ label: ProviderType.Anthropic },
			{ label: ProviderType.OpenAI },
			{ label: ProviderType.Gemini },
			{ label: ProviderType.AzureOpenAI }
		];

		const selectedModel = await vscode.window.showQuickPick(providers, {
			placeHolder: vscode.l10n.t('Select a provider.'),
		});

		if (!selectedModel) {
			// if quit out, it will not change the setting for provider nor model.
			return;
		}
		const config = vscode.workspace.getConfiguration();
		await config.update('copilot.vision.provider', selectedModel.label, vscode.ConfigurationTarget.Global);

		if (selectedModel.label === ProviderType.AzureOpenAI) {
			const currentEndpoint = config.get<string>('copilot.vision.azureEndpoint');

			const input = await vscode.window.showInputBox({
				placeHolder: currentEndpoint ? vscode.l10n.t(`Current Endpoint: ${currentEndpoint}`) : vscode.l10n.t('Enter an Azure OpenAI Endpoint. Example: https://example-endpoint.openai.azure.com'),
				prompt: 'Please enter an endpoint for the selected provider.',
				validateInput: (text: string) => {
					return text.length === 0 ? 'Input cannot be empty' : undefined;
				},
			});

			if (!input) {
				return;
			}

			await config.update('copilot.vision.azureEndpoint', input, vscode.ConfigurationTarget.Global);
		}

		const chatModel = getModel();
		const auth = new BaseAuth();
		const input = vscode.window.createInputBox();
		input.title = vscode.l10n.t('Set {0} Model', selectedModel.label);

		// Get Model
		input.placeholder = chatModel.model ? vscode.l10n.t(`Current Model: ${chatModel.model}`) : vscode.l10n.t('Enter a model');
		input.ignoreFocusOut = true;
		input.prompt = vscode.l10n.t('Please enter a model for the selected provider. Examples: `gpt-4o`, `claude-3-opus-20240229`, `gemini-1.5-flash`.');
		input.onDidChangeValue((value) => {
			input.validationMessage = undefined;
		});

		input.show();
		const currentKey = await context.secrets.get(selectedModel.label);
		try {
			const key: string = await new Promise((resolve, reject) => {
				const disposable = input.onDidAccept(async () => {
					input.busy = true;
					input.enabled = false;
					if (currentKey && !(await auth.validateKey(currentKey, input.value))) {
						input.validationMessage = vscode.l10n.t('Invalid Model');
						input.busy = false;
						input.enabled = true;
						return;
					}
					resolve(input.value);
					disposable.dispose();
					input.hide();
				});

				const hideDisposable = input.onDidHide(async () => {
					if (!input.value || (currentKey && !(await auth.validateKey(currentKey)))) {
						disposable.dispose();
						hideDisposable.dispose();
						resolve(chatModel.model);
					}
				});
			});

			await config.update('copilot.vision.model', key || chatModel.model, vscode.ConfigurationTarget.Global);
			if (!currentKey) {
				await vscode.commands.executeCommand('copilot.vision.setApiKey');
			}
		} catch (e) {
			console.error(e);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('copilot.vision.troubleshoot', async () => {
		const query = '@vision ' + troubleshootQuery;
		await vscode.commands.executeCommand('workbench.action.chat.open', { query, attachScreenshot: true });
	}));

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(['markdown', 'typescriptreact', 'html', 'javascriptreact'], new AltTextQuickFixProvider(context, vscode.workspace.getConfiguration), {
			providedCodeActionKinds: AltTextQuickFixProvider.providedCodeActionKinds
		})
	);
}

export function deactivate() { }
