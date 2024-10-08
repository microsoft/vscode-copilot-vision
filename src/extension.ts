import axios from 'axios';
import * as dotenv from 'dotenv';
import * as vscode from 'vscode';
import { ChatVariablesCollection } from './chatVariablesCollective';
import { AzureOpenAI } from "openai";
import { DefaultAzureCredential } from "@azure/identity";
import { Models } from 'openai/resources/models.mjs';

import screenshot from 'screenshot-desktop';
import * as path from 'path';
import * as os from 'os';
import { URI } from '@vscode/prompt-tsx/dist/base/util/vs/common/uri';

dotenv.config();

const VISION_PARTICIPANT_ID = 'chat-sample.vision';

const endpoint = process.env["AZURE_ENDPOINT"] || "https://vscode-openai.openai.azure.com/";
const apiVersion = "2024-05-01-preview";
const deployment = "gpt-4o-mini"; // This must match your deployment name
const AZURE_API_KEY = process.env["AZURE_API_KEY"];

interface IVisionChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
    }
}

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Use gpt-4o since it is fast and high quality. gpt-3.5-turbo and gpt-4 are also available.
const MODEL_SELECTOR: vscode.LanguageModelChatSelector = { vendor: 'copilot', family: 'gpt-4o' };
let imgPath: string | undefined;

export function activate(context: vscode.ExtensionContext) {


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
        imgPath = await takeScreenshot();
        if (imgPath) {
            const chatRequest = {
                input: '@vision troubleshoot my current VS Code setup',
                attachments: [
                    {
                        type: 'image',
                        path: imgPath
                    }
                ]
            };

            const uniqueId = generateIdUsingDateTime();
            const options = {
                query: chatRequest.input, images: [{
                    value: URI.from({ path: imgPath, scheme: 'file' }),
                    name: 'screenshot-' + uniqueId,
                    id: uniqueId
                }]
            };
            await vscode.commands.executeCommand('workbench.action.chat.open', options);
        } else {
            console.error('Failed to take screenshot.');
        }
    }));

    // Define a chat handler
    const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<IVisionChatResult> => {
        // To talk to an LLM in your subcommand handler implementation, your
        // extension can use VS Code's `requestChatAccess` API to access the Copilot API.
        // The GitHub Copilot Chat extension implements this provider.

        const chatVariables = new ChatVariablesCollection(request.references);
        stream.progress('Sending request to OpenAI...');

        if (!chatVariables.hasVariables()) {
            stream.markdown('I need a picture to generate a response.');
            return { metadata: { command: '' } };
        }

        let base64String = '';
        let mimeType = 'image/png';
        const content: Array<{ type: 'text', text: string } | { type: 'image_url', image_url: { url: string, detail?: string } }> = [
            { type: 'text', text: request.prompt },
        ];

        for (const { uniqueName: variableName, value: variableValue } of chatVariables) {
            // URI in cases of drag and drop or from file already in the workspace
            if (variableValue instanceof vscode.Uri) {
                const fileExtension = variableValue.path.split('.').pop()?.toLowerCase();
                const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff'];

                if (fileExtension && imageExtensions.includes(fileExtension)) {
                    const fileData = await vscode.workspace.fs.readFile(variableValue);
                    base64String = Buffer.from(fileData).toString('base64');
                    content.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64String}` } });
                } else {
                    stream.markdown(`The file ${variableName} is not an image.`);
                    return { metadata: { command: '' } };
                }

                // Object in cases of copy and paste (or from quick pick)
            } else if (typeof variableValue === 'object') {
                const variable = variableValue as vscode.ChatReferenceBinaryData;
                mimeType = variable.mimeType;
                const buffer = await variable.data();
                base64String = Buffer.from(buffer).toString('base64');
                content.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64String}` } });
            }
        }

        try {
            const openAIRequest = {
                model: 'gpt-4o', // Specify the OpenAI model you want to use
                messages: [{ role: 'user', content },]
            };

            // Send the request to OpenAI
            const response = await axios.post(OPENAI_API_URL, openAIRequest, {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            for (const choice of response.data.choices) {
                stream.markdown(choice.message.content);
            }

            // // Initialize the AzureOpenAI client with Entra ID (Azure AD) authentication
            // const client = new AzureOpenAI({ endpoint, apiVersion, deployment, apiKey: AZURE_API_KEY});  

            // // EXAMPLE OF USING AZURE OPENAI
            // const result = await client.chat.completions.create({
            // 	messages: [
            // 		{ role: 'user', content: request.prompt },
            // 		{ role: 'user', content: [{type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64String}`, detail: 'auto'}}] }
            // 	],
            // 	model: deployment, // Gpt4
            // 	max_tokens: 8192,
            // 	temperature: 0.7,
            // 	top_p: 0.95,
            // 	frequency_penalty: 0,
            // 	presence_penalty: 0
            // });

            // for (const choice of result.choices) {
            // 	if (choice.message.content) {
            // 		stream.markdown(choice.message.content);
            // 	}
            // }	


        } catch (err) {
            handleError(logger, err, stream);
        }

        return { metadata: { command: '' } };
    };

    const vision = vscode.chat.createChatParticipant(VISION_PARTICIPANT_ID, handler);
    vision.iconPath = vscode.Uri.joinPath(context.extensionUri, 'vscode-logo.png');
    // vision.followupProvider = {
    //     provideFollowups(result: ICatChatResult, context: vscode.ChatContext, token: vscode.CancellationToken) {
    //         return [{
    //             prompt: 'let us play',
    //             label: vscode.l10n.t('Play with the cat'),
    //             command: 'play'
    //         } satisfies vscode.ChatFollowup];
    //     }
    // };


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

async function takeScreenshot(): Promise<string | undefined> {
    try {
        const tmpDir = os.tmpdir();
        const imgPath = path.join(tmpDir, 'screenshot.jpg');
        await screenshot({ filename: imgPath });
        console.log(`Screenshot saved to ${imgPath}`);
        return imgPath;
    } catch (err) {
        console.error('Error taking screenshot:', err);
    }
}

function generateIdUsingDateTime(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

    return `${year}${month}${day}${hours}${minutes}${seconds}${milliseconds}`;
}