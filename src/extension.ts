import * as dotenv from 'dotenv';
import * as vscode from 'vscode';
import path from 'path';
import { registerHtmlPreviewCommands } from './htmlPreview';
import { extractImageAttributes } from './imageUtils';
import { generateAltText, getBufferAndMimeTypeFromUri } from './vscodeImageUtils';
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

export async function getKey(id: string, context: vscode.ExtensionContext): Promise<string | undefined> {
	const key = await context.secrets.get(id);
	return key;
}

export function getModel(): ChatModel {
	const config = vscode.workspace.getConfiguration();
	const currentModel = config.get<string>('copilot.vision.model');
	const currentProvider = config.get<ProviderType>('copilot.vision.provider');
	return { provider: currentProvider || ProviderType.OpenAI, model: currentModel || 'gpt-4o' };
}

export async function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.commands.registerCommand('copilot.vision.setApiKey', async () => {
		const auth = new BaseAuth();
		const provider = getModel().provider
		if (provider) {
			await auth.setAPIKey(context, provider);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('copilot.vision.deleteApiKey', async () => {
		const auth = new BaseAuth();
		const provider = getModel().provider
		if (provider) {
			await auth.deleteKey(context, provider);
		}
	}));

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

		const chatModel = getModel();
	
		// Prompt the user to enter a label
		const inputModel = await vscode.window.showInputBox({
			placeHolder: chatModel.model ? `Current Model: ${chatModel.model}` : 'Enter a model',
			prompt: 'Please enter a model for the selected provider. Examples: `gpt-4o`, `claude-3-opus-20240229`, `gemini-1.5-flash`.' //TODO: Deployments here as validd examples as we dev. Maybe find a good way to display deployments that suport vision based on selected model.
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

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider('markdown', new AltTextCodeLensProvider())
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vision.generateAltText', async (args) => {

			const { currentToken, currentModel } = await initializeModelAndToken(undefined, context);

			if (!currentToken || !currentModel) {
				return;
			}
      
			const altText = await generateAltText(currentModel, currentToken, args.resolvedImagePath, args.isHtml, args.type, true);

			if (!altText) {
				return;
			}
			const edit = new vscode.WorkspaceEdit();
			edit.replace(args.document.uri, new vscode.Range(args.range.start.line, args.altTextStartIndex, args.range.start.line, args.altTextStartIndex + args.altTextLength), altText);
			await vscode.workspace.applyEdit(edit);
		})
	)

	const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, contexts: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<IVisionChatResult> => {
		
		let {currentModel, currentToken} = await initializeModelAndToken(stream, context);

		if (!currentModel || !currentToken) {
			throw new Error('Something went wrong in the auth flow.');
		}

		stream.progress(`Generating response from ${currentModel?.provider}...`);

		if (!currentToken) {
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
				stream.markdown(message);
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

// Web accessibility guidelines suggest alt text should be between 20 and 30 words
const VERBOSE_WORD_COuNT = 30;
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
		const altTextIsVerbose = this._isVerbose(currentLine, parsed);
		const resolvedImagePath = path.resolve(path.dirname(document.uri.fsPath), parsed.imagePath);
		const verboseCodeLens = {
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
					altTextLength: parsed.altTextLength
				}]
			},
			range: new vscode.Range(editor.selection.active, editor.selection.active),
			isResolved: false
		};
		const customQueryCodeLens = {
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
						altTextLength: parsed.altTextLength
				}]
			},
			range: new vscode.Range(editor.selection.active, editor.selection.active),
			isResolved: false
		};
		if (altTextIsVerbose) {
			return [customQueryCodeLens];
		}
		return [verboseCodeLens, customQueryCodeLens];
	}

	private _isVerbose(currentLine: string, parsed: { imagePath: string; altTextStartIndex: number; isHTML: boolean; altTextLength: number; }): boolean {
		const altText = currentLine.substring(parsed.altTextStartIndex, parsed.altTextStartIndex + parsed.altTextLength);
		return altText.split(' ').length > VERBOSE_WORD_COuNT;
	}
}


