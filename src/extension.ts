/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dotenv from 'dotenv';
import * as vscode from 'vscode';
import path from 'path';
import { registerHtmlPreviewCommands } from './htmlPreview';
import { extractImageAttributes } from './utils/imageUtils';
import { generateAltText, getBufferAndMimeTypeFromUri } from './utils/vscodeImageUtils';
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
			const result = await api.create(currentToken, request.prompt, currentModel, base64Strings, mimeType);
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
		throw new Error('API key is not set.');
	}

	return { currentToken: contextToken, currentModel: chatModel };
}

export function deactivate() { }

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
			{ label: ProviderType.Gemini }
		];

		const selectedModel = await vscode.window.showQuickPick(providers, {
			placeHolder: vscode.l10n.t('Select a provider.'),
		});

		if (!selectedModel) {
			return;
		}

		const chatModel = getModel();

		// Prompt the user to enter a label
		const inputModel = await vscode.window.showInputBox({
			placeHolder: chatModel.model ? vscode.l10n.t(`Current Model: ${chatModel.model}`) : vscode.l10n.t('Enter a model'),
			prompt: vscode.l10n.t('Please enter a model for the selected provider. Examples: `gpt-4o`, `claude-3-opus-20240229`, `gemini-1.5-flash`.') 
		});

		if (!inputModel) {
			return;
		}

		// Update the configuration settings
		const config = vscode.workspace.getConfiguration();
		await config.update('copilot.vision.provider', selectedModel.label, vscode.ConfigurationTarget.Global);
		await config.update('copilot.vision.model', inputModel, vscode.ConfigurationTarget.Global);
	}));

	context.subscriptions.push(...registerHtmlPreviewCommands());

	context.subscriptions.push(vscode.commands.registerCommand('copilot.vision.troubleshoot', async () => {
		const query = '@vision troubleshoot my VS Code setup, as pictured.';
		await vscode.commands.executeCommand('workbench.action.chat.open', { query, attachScreenshot: true });
	}));

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('markdown', new AltTextQuickFixProvider(context), {
			providedCodeActionKinds: AltTextQuickFixProvider.providedCodeActionKinds
		})
	);
}


