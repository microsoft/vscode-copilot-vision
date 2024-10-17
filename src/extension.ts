import * as dotenv from 'dotenv';
import * as vscode from 'vscode';
import path from 'path';
import { AnthropicAuthProvider, GeminiAuthProvider, OpenAIAuthProvider } from './auth/authProvider';
import { ApiKeySecretStorage } from './auth/secretStorage';
import { registerHtmlPreviewCommands } from './htmlPreview';
import { extractImageAttributes } from './imageUtils';
import { generateAltText, getBufferAndMimeTypeFromUri } from './vscodeImageUtils';
import { AltTextQuickFixProvider } from './altTextQuickFixProvider';
import { getApi } from './apiFacade';

dotenv.config();

const VISION_PARTICIPANT_ID = 'chat-sample.vision';

// OpenAI credentials
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

let cachedToken: string | undefined;
let cachedModel: ChatModel | undefined;

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

	await registerAuthProviders(context);

	context.subscriptions.push(vscode.commands.registerCommand('copilot.vision.selectProviderAndModel', async () => {
		const providers = [
			{ label: ProviderType.Anthropic },
			{ label: ProviderType.OpenAI },
			{ label: ProviderType.Gemini }
		];

		const selectedModel = await vscode.window.showQuickPick(providers, {
			// TODO: Localization
			placeHolder: 'Select a provider.',
		});

		if (!selectedModel) {
			return;
		}

		// Prompt the user to enter a label
		const inputModel = await vscode.window.showInputBox({
			placeHolder: cachedModel?.model ? `Current Model: ${cachedModel?.model}` : 'Enter a model',
			prompt: 'Please enter a model for the selected provider. Examples: `gpt-4o`, `claude-3-opus-20240229`, `gemini-1.5-flash`.' //TODO: Deployments here as validd examples as we dev. Maybe find a good way to display deployments that suport vision based on selected model.
		});

		if (!inputModel) {
			return;
		}

		// Update the configuration settings
		const config = vscode.workspace.getConfiguration();
		await config.update('copilot.vision.provider', selectedModel.label, vscode.ConfigurationTarget.Global);
		await config.update('copilot.vision.model', inputModel, vscode.ConfigurationTarget.Global);


		// Handle the selected provider and input model
		cachedModel = { provider: selectedModel.label, model: inputModel };
	}));
	context.subscriptions.push(...registerHtmlPreviewCommands());

	context.subscriptions.push(vscode.commands.registerCommand('troubleshootWithVision', async () => {
		const query = '@vision troubleshoot my VS Code setup, as pictured.';
		await vscode.commands.executeCommand('workbench.action.chat.open', { query, attachScreenshot: true });
	}));

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('markdown', new AltTextQuickFixProvider(), {
			providedCodeActionKinds: AltTextQuickFixProvider.providedCodeActionKinds
		})
	);

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider('markdown', new AltTextCodeLensProvider())
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vision.generateAltText', async (args) => {
			if (!cachedToken || !cachedModel) {
				await initializeModelAndToken();
			}
			if (!cachedToken || !cachedModel) {
				return;
			}
			const altText = await generateAltText(cachedModel, cachedToken, args.resolvedImagePath, args.isHtml, args.type, args.altAfterSrc, true);
			if (!altText) {
				return;
			}
			const edit = new vscode.WorkspaceEdit();
			if (args.isHtml) {
				if (args.altAfterSrc) {
					// alt="text"
					edit.replace(args.document.uri, new vscode.Range(args.range.start.line, args.altTextStartIndex + 8, args.range.start.line, args.altTextStartIndex + args.altTextLength), altText);
				} else {
					// <img alt="text"
					edit.replace(args.document.uri, new vscode.Range(args.range.start.line, args.altTextStartIndex + 9, args.range.start.line, args.altTextStartIndex + args.altTextLength + 9), altText);
				}
			} else {
				edit.replace(args.document.uri, new vscode.Range(args.range.start.line, args.altTextStartIndex, args.range.start.line, args.altTextStartIndex + args.altTextLength), altText);
			}
			await vscode.workspace.applyEdit(edit);
		})
	)

	const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<IVisionChatResult> => {
		await initializeModelAndToken(stream);

		if (!cachedModel || !cachedToken) {
			throw new Error('Something went wrong in the auth flow.');
		}

		stream.progress(`Generating response from ${cachedModel?.provider}...`);

		if (!cachedToken) {
			handleError(logger, new Error('Please provide a valid API key.'), stream);
			return { metadata: { command: '' } };
		}

		const chatVariables = request.references;
		if (chatVariables.length === 0) {
			stream.markdown('I need a picture to generate a response.');
			return { metadata: { command: '' } };
		}

		let base64Strings: Buffer[] = [];
		let mimeType: string | undefined;

		for (const reference of chatVariables) {
			// URI in cases of drag and drop or from file already in the workspace
			if (reference.value instanceof vscode.Uri) {
				const result = await getBufferAndMimeTypeFromUri(reference.value);
				if (!result) {
					stream.markdown(`The file is not an image.`);
					return { metadata: { command: '' } };
				}
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
			const api = getApi(cachedModel.provider);
			const result = await api.create(cachedToken, request.prompt, cachedModel, base64Strings, mimeType);
			for (const message of result) {
				stream.markdown(message);
			}

		} catch (err: unknown) {
			// Invalidate token if it's a 401 error
			if (typeof err === 'object' && err && 'status' in err && err.status === 401) {
				cachedToken = undefined;
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

async function getOpenAiApiToken(): Promise<string | undefined> {
	// Return cached token if available
	if (cachedToken) {
		return cachedToken;
	}

	// Pick up environment variable (mostly for development)
	if (OPENAI_API_KEY) {
		return OPENAI_API_KEY;
	}

	// Get from simple input box
	const inputBox = vscode.window.createInputBox();
	inputBox.ignoreFocusOut = true;
	inputBox.title = 'Enter Azure OpenAI API Key';
	const disposables: vscode.Disposable[] = [];
	const value = new Promise<string | undefined>(r => {
		inputBox.onDidTriggerButton(e => {
		});
		disposables.push(inputBox.onDidAccept(() => {
			inputBox.hide();
			r(inputBox.value);
		}));
		disposables.push(inputBox.onDidHide(() => {
			r(undefined);
		}));
	});
	inputBox.show();

	cachedToken = await value;
	if (!cachedToken) { // Normalize
		cachedToken = undefined;
	}

	for (const d of disposables) {
		d.dispose();
	}

	return cachedToken;
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

async function registerAuthProviders(context: vscode.ExtensionContext) {
	const openAISecretStorage = new ApiKeySecretStorage('openai.keys', context);
	await openAISecretStorage.initialize();
	const openAIAuthProvider = new OpenAIAuthProvider(openAISecretStorage);

	const anthropicSecretStorage = new ApiKeySecretStorage('anthropic.keys', context);
	await anthropicSecretStorage.initialize();
	const anthropicAuthProvider = new AnthropicAuthProvider(anthropicSecretStorage);

	const geminiSecretStorage = new ApiKeySecretStorage('bing.keys', context);
	await geminiSecretStorage.initialize();
	const geminiAuthProvider = new GeminiAuthProvider(geminiSecretStorage);

	context.subscriptions.push(vscode.Disposable.from(
		openAIAuthProvider,
		vscode.authentication.registerAuthenticationProvider(OpenAIAuthProvider.ID, OpenAIAuthProvider.NAME, new OpenAIAuthProvider(openAISecretStorage), { supportsMultipleAccounts: true }),
		anthropicAuthProvider,
		vscode.authentication.registerAuthenticationProvider(AnthropicAuthProvider.ID, AnthropicAuthProvider.NAME, new AnthropicAuthProvider(anthropicSecretStorage), { supportsMultipleAccounts: true }),
		geminiAuthProvider,
		vscode.authentication.registerAuthenticationProvider(GeminiAuthProvider.ID, GeminiAuthProvider.NAME, new GeminiAuthProvider(geminiSecretStorage), { supportsMultipleAccounts: true })
	));
}

export async function initializeModelAndToken(stream?: vscode.ChatResponseStream): Promise<{ cachedToken: string | undefined, cachedModel: ChatModel | undefined }> {
	// Default to Azure Open AI, only use a different model if one is selected explicitly
	// through the model picker command
	const config = vscode.workspace.getConfiguration();
	const provider = config.get<ProviderType>('copilot.vision.provider');
	const model = config.get<string>('copilot.vision.model')

	if (!cachedModel || (!provider && !model)) {
		cachedModel = {
			provider: ProviderType.OpenAI,
			model: 'gpt-4o'
		}
	}

	if (provider && model) {
		cachedModel = { provider, model };
	}

	if (cachedModel.provider === ProviderType.OpenAI && OPENAI_API_KEY) {
		cachedToken = OPENAI_API_KEY
	} else {
		stream?.progress(`Setting ${cachedModel.provider} API key...`);
		const session = await vscode.authentication.getSession(cachedModel.provider, [], {
			createIfNone: true,
		});

		if (!session) {
			throw new Error('Please provide an API key to use this feature.');
		}

		cachedToken = session.accessToken;
	}
	return { cachedToken, cachedModel };
}

export function deactivate() { }

export class AltTextCodeLensProvider implements vscode.CodeLensProvider {
	// a class that allows you to generate more verbose alt text or provide a custom query
	provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return [];
		}
		const currentLine = editor.document.lineAt(editor.selection.active.line).text;
		const parsed = extractImageAttributes(currentLine, true);

		if (!parsed) {
			return;
		}

		const resolvedImagePath = path.resolve(path.dirname(document.uri.fsPath), parsed.imagePath);
		return [{
			command: {
				title: 'Increase alt text verbosity', command: 'vision.generateAltText', arguments: [{
					resolvedImagePath,
					currentLine,
					altTextStartIndex: parsed.altTextStartIndex,
					isHtml: parsed.isHTML,
					document,
					range: new vscode.Range(editor.selection.active, editor.selection.active),
					isResolved: true,
					type: 'verbose',
					altTextLength: parsed.altTextLength,
					altAfterSrc: parsed.altAfterSrc
				}]
			},
			range: new vscode.Range(editor.selection.active, editor.selection.active),
			isResolved: false
		}
			, {
			command: {
					title: 'Refine alt text...', command: 'vision.generateAltText', arguments: [{
					resolvedImagePath,
					currentLine,
					altTextStartIndex: parsed.altTextStartIndex,
					isHtml: parsed.isHTML,
					document,
					range: new vscode.Range(editor.selection.active, editor.selection.active),
					isResolved: true,
					type: 'query',
					altTextLength: parsed.altTextLength,
					altAfterSrc: parsed.altAfterSrc
				}]
			},
			range: new vscode.Range(editor.selection.active, editor.selection.active),
			isResolved: false
		}];
	}
}


