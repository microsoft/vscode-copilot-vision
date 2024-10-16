import * as dotenv from 'dotenv';
import * as vscode from 'vscode';
import { getApi } from './apiFacade';
import { AnthropicAuthProvider, GeminiAuthProvider, OpenAIAuthProvider } from './auth/authProvider';
import { ApiKeySecretStorage } from './auth/secretStorage';
import { registerHtmlPreviewCommands } from './htmlPreview';

dotenv.config();

const VISION_PARTICIPANT_ID = 'chat-sample.vision';

// OpenAI credentials
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Anthropic
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

let cachedToken: string | undefined;
let cachedModel: ChatModel | undefined;

export enum ModelType {
	Anthropic = 'Anthropic',
	OpenAI = 'OpenAI',
	Gemini = 'Gemini',
	AzureOpenAI = 'AzureOpenAI'
}

export interface ChatModel {
	type: ModelType;
	deployment: string;
}

interface IVisionChatResult extends vscode.ChatResult {
	metadata: {
		command: string;
	}
}

export function activate(context: vscode.ExtensionContext) {

	registerAuthProviders(context);

	context.subscriptions.push(vscode.commands.registerCommand('copilot.vision.selectModelAndDeployment', async () => {
		const models = [
			{ label: ModelType.Anthropic },
			{ label: ModelType.OpenAI },
			{ label: ModelType.Gemini }
		];

		const selectedModel = await vscode.window.showQuickPick(models, {
			// TODO: Localization
			placeHolder: 'Select a model',
		});

		if (!selectedModel) {
			return;
		}

		// Prompt the user to enter a label
		const inputDeployment = await vscode.window.showInputBox({
			placeHolder: cachedModel?.deployment ? `Current Deployment: ${cachedModel?.deployment}` : 'Enter a deployment',
			prompt: 'Please enter a deployment for the selected model. Examples: `gpt-4o`, `claude-3-opus-20240229`, `gemini-1.5-flash`.' //TODO: Deployments here as validd examples as we dev. Maybe find a good way to display deployments that suport vision based on selected model.
		});

		if (!inputDeployment) {
			return;
		}

		// Update the configuration settings
		const config = vscode.workspace.getConfiguration();
		await config.update('copilot.vision.model', selectedModel.label, vscode.ConfigurationTarget.Global);
		await config.update('copilot.vision.deployment', inputDeployment, vscode.ConfigurationTarget.Global);
		

		// Handle the selected model and input deployment
		cachedModel = { type: selectedModel.label, deployment: inputDeployment };
	}));
	context.subscriptions.push(...registerHtmlPreviewCommands());

	context.subscriptions.push(vscode.commands.registerCommand('troubleshootWithVision', async () => {
		const query = '@vision troubleshoot my VS Code setup, as pictured.';
		await vscode.commands.executeCommand('workbench.action.chat.open', { query, attachScreenshot: true });
	}));

	const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<IVisionChatResult> => {
		// Default to Azure Open AI, only use a different model if one is selected explicitly
		// through the model picker command
		stream.progress('Selecting model...');
		const config = vscode.workspace.getConfiguration();
		const modelType = config.get<ModelType>('copilot.vision.model');
		const deployment = config.get<string>('copilot.vision.deployment')

		if (!cachedModel || (!modelType && !deployment)) {
			cachedModel = {
				type: ModelType.OpenAI,
				deployment: 'gpt-4o'
			}
		}

		if (modelType && deployment) {
			cachedModel = { type: modelType, deployment };
		}

		if (cachedModel.type === ModelType.OpenAI && OPENAI_API_KEY) {
			cachedToken = OPENAI_API_KEY
		} else {
			const session = await vscode.authentication.getSession(cachedModel.type, [], {
				createIfNone: true,
			});

			if (!session) {
				throw new Error('Please provide an API key to use this feature.');
			}

			cachedToken = session.accessToken;
		}


		stream.progress(`Generating response from ${cachedModel?.type}...`);

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
				const fileExtension = reference.value.path.split('.').pop()?.toLowerCase();
				const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff'];

				function getMimeType(ext: string) {
					if (ext === 'jpg') {
						return 'image/jpeg';
					}
					return `image/${ext}`;
				}

				if (fileExtension && imageExtensions.includes(fileExtension)) {
					base64Strings.push(Buffer.from(await vscode.workspace.fs.readFile(reference.value)));
					mimeType = getMimeType(fileExtension)
				} else {
					stream.markdown(`The file is not an image.`);
					return { metadata: { command: '' } };
				}

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
			const api = getApi(cachedModel.type);
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
	vision.iconPath = vscode.Uri.joinPath(context.extensionUri, 'vscode-logo.png');

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

function registerAuthProviders(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.authentication.registerAuthenticationProvider(
		OpenAIAuthProvider.ID,
		OpenAIAuthProvider.NAME,
		new OpenAIAuthProvider(new ApiKeySecretStorage('openai.keylist', context)),
		{ supportsMultipleAccounts: true }
	));

	context.subscriptions.push(vscode.authentication.registerAuthenticationProvider(
		AnthropicAuthProvider.ID,
		AnthropicAuthProvider.NAME,
		new AnthropicAuthProvider(new ApiKeySecretStorage('anthropic.keylist', context)),
		{ supportsMultipleAccounts: true }
	));

	context.subscriptions.push(vscode.authentication.registerAuthenticationProvider(
		GeminiAuthProvider.ID,
		GeminiAuthProvider.NAME,
		new GeminiAuthProvider(new ApiKeySecretStorage('gemini.keylist', context)),
		{ supportsMultipleAccounts: true }
	));
}

export function deactivate() { }
