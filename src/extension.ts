import * as dotenv from 'dotenv';
import * as vscode from 'vscode';
import OpenAI from 'openai';
import { AzureOpenAI } from "openai";
import type { ChatCompletionContentPart } from 'openai/resources/index.mjs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import { ImageBlockParam, TextBlock, TextBlockParam } from '@anthropic-ai/sdk/src/resources/messages.js';
import { ContentBlock } from '@anthropic-ai/sdk/resources/messages.mjs';

dotenv.config();

const VISION_PARTICIPANT_ID = 'chat-sample.vision';

// Azure OpenAI credentials
const endpoint = process.env["AZURE_ENDPOINT"] || "https://vscode-openai.openai.azure.com/";
const apiVersion = "2024-05-01-preview";
const deployment = "gpt-4o-mini"; // This must match your deployment name
const AZURE_API_KEY = process.env["AZURE_API_KEY"];

// OpenAI credentials
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Anthropic
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

let cachedToken: string | undefined;
let cachedModel: ChatModel | undefined;

enum ModelType {
	Anthropic = 'Anthropic',
	OpenAI = 'OpenAI',
	Gemini = 'Gemini',
	AzureOpenAI = 'AzureOpenAI'
}

interface ChatModel {
	type: ModelType;
	model: string;
}

interface IVisionChatResult extends vscode.ChatResult {
	metadata: {
		command: string;
	}
}

function getApi(type: ModelType): ApiFacade {
	switch (type) {
		case ModelType.Gemini:
			return new GeminiApi();
		case ModelType.Anthropic:
			return new AnthropicApi();
		case ModelType.OpenAI:
			return new OpenAiApi();
		default:
			throw new Error('Invalid model type');
	}
}


interface ApiFacade {
	create(apiKey: string, request: string, provider: ChatModel, content: Buffer[], mimeType: string): Promise<string[]>;
}

class AnthropicApi implements ApiFacade {
	async create(apiKey: string, request: string, provider: ChatModel, content: Buffer[], mimeType: string): Promise<string[]> {
		const client = new Anthropic({ apiKey: apiKey });

		const prompts: Array<TextBlockParam | ImageBlockParam> = [
			{ type: 'text', text: request },
		];

		for (const data of content) {
			const base64 = data.toString('base64');
			prompts.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } });
		}

		const result = await client.messages.create({
			max_tokens: 1024,
			messages: [{ role: 'user', content: prompts }],
			model: provider.model, //'claude-3-opus-20240229'
		});

		// return messages;
		return result.content.map((content: ContentBlock) => content.type === 'text' ? (content as TextBlock).text : '');
	}
}

class OpenAiApi implements ApiFacade {
	async create(apiKey: string, request: string, provider: ChatModel, content: Buffer[], mimeType: string): Promise<string[]> {
		if (apiKey === undefined) {
			// stream.markdown('Please provide a valid Open AI token.');
			return ['Please provide a valid Open AI token.'];
		}

		const prompts: ChatCompletionContentPart[] = [
			{ type: 'text', text: request },
		];

		for (const data of content) {
			const base64 = data.toString('base64');
			prompts.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } });
		}

		const openAi = new OpenAI({
			baseURL: 'https://api.openai.com/v1',
			apiKey
		});

		const res = await openAi.chat.completions.create({
			model: provider.model, // gpt-4o
			messages: [
				{ role: 'user', content: prompts }
			]
		});

		const messages = []

		for (const choice of res.choices) {
			if (choice.message.content) {
				messages.push(choice.message.content);
			}
		}

		return messages;
	}
}

class GeminiApi implements ApiFacade {
	async create(apiKey: string, request: string, provider: ChatModel, content: Buffer[], mimeType: string): Promise<string[]> {

		function getFilePart(buffer: Buffer) {
			return {
				inlineData: {
					data: buffer.toString('base64'),
					mimeType
				}
			};
		}

		// for multiple images
		const imageParts = [];

		for (const buffer of content) {
			imageParts.push(getFilePart(buffer));
		}

		const genAI = new GoogleGenerativeAI(apiKey);
		const model = genAI.getGenerativeModel({ model: provider.model }); // 'gemini-1.5-flash'
		const generatedContent = await model.generateContent(["Tell me about this image", ...imageParts]);

		const messages = [];

		for (const part of generatedContent.response.text()) {
			messages.push(part);
		}
		return messages;
	}
}

export function activate(context: vscode.ExtensionContext) {

	// Register the command
	const modelSelector = vscode.commands.registerCommand('extension.selectModelAndDeployment', async () => {
		const models = [
			{ label: ModelType.Anthropic },
			{ label: ModelType.OpenAI },
			{ label: ModelType.Gemini }
		];

		const selectedModel = await vscode.window.showQuickPick(models, {
			placeHolder: 'Select a model',
		});

		if (!selectedModel) {
			return;
		}
		vscode.window.showInformationMessage(`You selected: ${selectedModel.label}`);

		// Prompt the user to enter a label
		const inputDeployment = await vscode.window.showInputBox({
			placeHolder: cachedModel?.model ?? 'Enter a deployment',
			prompt: 'Please enter a deployment for the selected model'
		});

		if (!inputDeployment) {
			return;
		}

		vscode.window.showInformationMessage(`You entered: ${inputDeployment}`);

		// Prompt the user to enter an API key
		const inputApiKey = await vscode.window.showInputBox({
			placeHolder: 'Enter your API key',
			prompt: 'Please enter the API key for the selected model',
			password: true
		});

		if (!inputApiKey) {
			return;
		}

		vscode.window.showInformationMessage(`API key entered`);
		cachedToken = inputApiKey;

		if (!cachedToken) { // Normalize
			cachedToken = undefined;
		}

		// Handle the selected model and input deployment
		cachedModel = { type: selectedModel.label, model: inputDeployment };
	});

	context.subscriptions.push(modelSelector);

	const disposable = vscode.commands.registerCommand('extension.showHtmlPreview', () => {
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

		const provider = await getModelAndDeployment();

		stream.progress(`Generating response from ${cachedModel?.type}...`);

		if (!cachedToken) {
			handleError(logger, new Error('Please provide a valid API key.'), stream);
			return { metadata: { command: '' } };
		}

		if (!provider?.type || !provider.model) {
			handleError(logger, new Error('Please provide a valid model and deployment.'), stream);
			return { metadata: { command: '' } };
		}

		const apiKey = cachedToken;

		if (chatVariables.length === 0) {
			stream.markdown('I need a picture to generate a response.');
			return { metadata: { command: '' } };
		}

		let base64Strings = [];
		let mimeType = 'image/png';

		for (const reference of chatVariables) {
			// URI in cases of drag and drop or from file already in the workspace
			if (reference.value instanceof vscode.Uri) {
				const fileExtension = reference.value.path.split('.').pop()?.toLowerCase();
				const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff'];

				if (fileExtension && imageExtensions.includes(fileExtension)) {
					const fileData = await vscode.workspace.fs.readFile(reference.value);
					base64Strings.push(Buffer.from(fileData));
				} else {
					stream.markdown(`The file is not an image.`);
					return { metadata: { command: '' } };
				}

				// ChatReferenceBinaryData in cases of copy and paste (or from quick pick)
			} else if (reference.value instanceof vscode.ChatReferenceBinaryData) {
				mimeType = reference.value.mimeType;
				const buffer = await reference.value.data();
				base64Strings.push(Buffer.from(buffer));
			}
		}

		try {
			const api = getApi(provider.type);
			const result = await api.create(apiKey, request.prompt, provider, base64Strings, mimeType);
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
		await vscode.commands.executeCommand('extension.selectModelAndDeployment');
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
