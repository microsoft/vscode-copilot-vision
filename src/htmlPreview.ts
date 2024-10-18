/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function registerHtmlPreviewCommands(): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('copilot.vision.showHtmlPreview', () => {
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
		})
	];
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
