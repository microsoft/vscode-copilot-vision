import * as dotenv from 'dotenv';
import * as vscode from 'vscode';
import { getApi } from './apiFacade';
import path from 'path';

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

	// Update API key
	const updateApiKeyCommand = vscode.commands.registerCommand('copilot.vision.updateApiKey', async () => {
		// Prompt the user to enter a new API key
		const apiKey = await vscode.window.showInputBox({
			placeHolder: 'Enter your API key',
			prompt: 'Please enter the API key',
			password: true
		});

		if (!apiKey) {
			vscode.window.showErrorMessage('No API key entered.');
			return;
		}

		// Update the cached token
		cachedToken = apiKey;
	});

	context.subscriptions.push(updateApiKeyCommand);

	const modelSelector = vscode.commands.registerCommand('copilot.vision.selectModelAndDeployment', async () => {
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

		// Prompt the user to enter an API key
		const inputApiKey = await vscode.window.showInputBox({
			placeHolder: 'Enter your API key',
			prompt: 'Please enter the API key for the selected model',
			password: true
		});

		if (!inputApiKey) {
			return;
		}

		cachedToken = inputApiKey;

		if (!cachedToken) { // Normalize
			cachedToken = undefined;
		}

		// Update the configuration settings
		const config = vscode.workspace.getConfiguration();
		await config.update('copilot.vision.model', selectedModel.label, vscode.ConfigurationTarget.Global);
		await config.update('copilot.vision.deployment', inputDeployment, vscode.ConfigurationTarget.Global);
		

		// Handle the selected model and input deployment
		cachedModel = { type: selectedModel.label, deployment: inputDeployment };
	});

	context.subscriptions.push(modelSelector);

	const disposable = vscode.commands.registerCommand('copilot.vision.showHtmlPreview', () => {
		const panel = vscode.window.createWebviewPanel(
			'htmlPreview', // Identifies the type of the webview. Used internally
			'HTML Preview', // Title of the panel displayed to the user
			vscode.ViewColumn.One, // Editor column to show the new webview panel in
			{
				enableScripts: true // Enable scripts in the webview
			}
		);

		// Set the HTML content for the webview
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const htmlContent = editor.document.getText();
			panel.webview.html = getWebviewContent(htmlContent);
		} else {
			vscode.window.showErrorMessage('No active text editor found.');
		}
	});

	context.subscriptions.push(disposable);

	context.subscriptions.push(vscode.commands.registerCommand('troubleshootWithVision', async () => {
		const query = '@vision troubleshoot my VS Code setup, as pictured.';
		await vscode.commands.executeCommand('workbench.action.chat.open', { query, attachScreenshot: true });
	}));

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('markdown', new AltTextGenerator(), {
			providedCodeActionKinds: AltTextGenerator.providedCodeActionKinds
		})
	);

	const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<IVisionChatResult> => {
		// To talk to an LLM in your subcommand handler implementation, your
		// extension can use VS Code's `requestChatAccess` API to access the Copilot API.
		// The GitHub Copilot Chat extension implements this provider.

		// This just converts our sources/references into more digestible format. Helpful for more complex variables.
		// const chatVariables = new ChatVariablesCollection(request.references);;

		const chatVariables = request.references;
		if (!cachedModel) {
			stream.progress('Selecting model...');
		}

		const model = await getModelAndDeployment();

		stream.progress(`Generating response from ${cachedModel?.type}...`);

		if (!cachedToken) {
			handleError(logger, new Error('Please provide a valid API key.'), stream);
			return { metadata: { command: '' } };
		}

		if (!model?.type || !model.deployment) {
			handleError(logger, new Error('Please provide a valid model and deployment.'), stream);
			return { metadata: { command: '' } };
		}

		const apiKey = cachedToken;

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
			const api = getApi(model.type);
			const result = await api.create(apiKey, request.prompt, model, base64Strings, mimeType);
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

async function getModelAndDeployment(): Promise<ChatModel | undefined> {
	// Return cached model if available
	if (cachedModel) {
		return cachedModel;
	}

	// If no cachedModel, run the command that makes a user select the model
	if (!cachedModel) {
		await vscode.commands.executeCommand('copilot.vision.selectModelAndDeployment');
		return cachedModel;
	}
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

function getWebviewContent(htmlContent: string): string {
	return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>HTML Preview</title>
			<style>
				body, html {
					margin: 0;
					padding: 0;
					height: 100%;
					width: 100%;
					position: relative;
					overflow: hidden;
				}
				.content {
					position: relative;
					z-index: 1;
					padding-top: 60px; /* Ensure buttons don't overlap the content */
				}
				.canvas-container {
					position: absolute;
					top: 0;
					left: 0;
					width: 100%;
					height: 100%;
					z-index: 2;
				}
				canvas {
					width: 100%;
					height: 100%;
					border: none;
				}
				.controls {
					position: fixed;
					top: 10px;
					left: 10px;
					z-index: 9999;
					display: flex;
					flex-direction: row; /* Display in a row */
					gap: 10px; /* Add space between controls */
				}
				.controls button, .controls input, .controls select {
					padding: 10px;
					background-color: #4CAF50;
					color: white;
					border: none;
					border-radius: 5px;
					cursor: pointer;
				}
				.controls button:hover {
					background-color: #45a049;
				}
			</style>
		</head>
		<body>
			<div class="content">
				${htmlContent}
			</div>
			<div class="canvas-container">
				<canvas id="canvas"></canvas>
			</div>
			<div class="controls">
				<button id="exportBtn">Export as Image</button>
				<input type="color" id="colorPicker" value="#000000">
				<select id="shapePicker">
					<option value="draw">Draw</option>
					<option value="rectangle">Rectangle</option>
					<option value="circle">Circle</option>
				</select>
			</div>

			<script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/4.5.0/fabric.min.js"></script>
			<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/0.5.0-beta4/html2canvas.min.js"></script>
			<script>
				const canvasElement = document.getElementById('canvas');
				const canvas = new fabric.Canvas(canvasElement);

				// Make canvas fill the screen and allow drawing
				canvas.setWidth(window.innerWidth);
				canvas.setHeight(window.innerHeight);
				canvas.isDrawingMode = true;

				// Adjust canvas size when window is resized
				window.addEventListener('resize', () => {
					canvas.setWidth(window.innerWidth);
					canvas.setHeight(window.innerHeight);
					canvas.renderAll();
				});

				// Change pen color
				document.getElementById('colorPicker').addEventListener('change', function() {
					canvas.freeDrawingBrush.color = this.value;
				});

				// Shape drawing
				document.getElementById('shapePicker').addEventListener('change', function() {
					canvas.isDrawingMode = this.value === 'draw';
					if (this.value === 'rectangle') {
						const rect = new fabric.Rect({
							left: 100,
							top: 100,
							fill: canvas.freeDrawingBrush.color,
							width: 200,
							height: 100
						});
						canvas.add(rect);
					} else if (this.value === 'circle') {
						const circle = new fabric.Circle({
							left: 150,
							top: 150,
							radius: 50,
							fill: canvas.freeDrawingBrush.color
						});
						canvas.add(circle);
					}
				});

				// Export the combined HTML and canvas as an image
				document.getElementById('exportBtn').addEventListener('click', () => {
					html2canvas(document.querySelector('.content')).then(htmlCanvas => {
						const finalCanvas = document.createElement('canvas');
						finalCanvas.width = htmlCanvas.width;
						finalCanvas.height = htmlCanvas.height;
						const ctx = finalCanvas.getContext('2d');

						ctx.drawImage(htmlCanvas, 0, 0);

						const fabricCanvasImage = canvas.toDataURL();
						const img = new Image();
						img.src = fabricCanvasImage;
						img.onload = () => {
							ctx.drawImage(img, 0, 0);
							const finalImage = finalCanvas.toDataURL("image/png");
							const link = document.createElement('a');
							link.href = finalImage;
							link.download = 'exported-image.png';
							link.click();
						};
					});
				});
			</script>
		</body>
		</html>
	`;
}

export function deactivate() { }


interface ImageCodeAction extends vscode.CodeAction {
	document: vscode.TextDocument;
	range: vscode.Range;
	resolvedImagePath: string;
	currentLine: string;
}

export class AltTextGenerator implements vscode.CodeActionProvider<ImageCodeAction> {
	public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

	async provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<ImageCodeAction[] | undefined> {
		if (!cachedToken || !cachedModel) {
			return;
		}

		const currentLine = document.lineAt(range.start.line).text;

		// TODO: @meganrogge also look at the other formats of markdown images and handle them as well
		const match = currentLine.match(/!\[\]\(([^)]+)\)/);
		if (!match) {
			return;
		}
		const imagePath = match[1];
		if (!imagePath) {
			return;
		}

		const resolvedImagePath = path.resolve(path.dirname(document.uri.fsPath), imagePath);
		return [{ title: 'Generate alt text', kind: vscode.CodeActionKind.QuickFix, range, document, resolvedImagePath, currentLine }] as ImageCodeAction[];
	}

	async resolveCodeAction(codeAction: ImageCodeAction, token: vscode.CancellationToken): Promise<ImageCodeAction | undefined> {
		if (!cachedModel || !cachedToken || token.isCancellationRequested) {
			return;
		}
		const altText = await generateAltText(cachedModel, cachedToken, codeAction.resolvedImagePath);
		if (!altText) {
			return;
		}
		codeAction.edit = new vscode.WorkspaceEdit();
		const altTextStart = codeAction.currentLine.indexOf('[]') + 1;
		const edit = new vscode.WorkspaceEdit();
		edit.insert(codeAction.document.uri, new vscode.Position(codeAction.range.start.line, altTextStart), altText);
		codeAction.edit = edit;
		return codeAction;
	}
}

async function generateAltText(model: ChatModel, apiKey: string, imagePath: string): Promise<string | undefined> {
	const uri = vscode.Uri.file(imagePath);
	const fileExtension = uri.path.split('.').pop()?.toLowerCase();
	const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff'];

	function getMimeType(ext: string) {
		if (ext === 'jpg') {
			return 'image/jpeg';
		}
		return `image/${ext}`;
	}

	if (!fileExtension || !imageExtensions.includes(fileExtension)) {
		return;
	}
	const buffer = Buffer.from(await vscode.workspace.fs.readFile(uri));
	const mimeType = getMimeType(fileExtension)

	try {
		const api = getApi(model.type);
		const altText = (await api.create(apiKey, 'Generate alt text for this image. Be very concise. Do not include sighted person info like colors.', model, [buffer], mimeType)).join(' ');
		return altText;
	} catch (err: unknown) {
		// Invalidate token if it's a 401 error
		if (typeof err === 'object' && err && 'status' in err && err.status === 401) {
			cachedToken = undefined;
		}
		return;
	}
}