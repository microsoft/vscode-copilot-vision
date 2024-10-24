# Description

Vision for Copilot Preview is an extension that enhances chat interactions by enabling users to leverage advanced vision capabilities. This preview feature allows users to attach images directly as contextual input, enriching conversations and enabling more dynamic, visually-supported responses. This extension will be eventually deprecated in favor of built-in image flow in Github Copilot Chat. 

### Chat
For now, users can experience the image attachment flow in the chat panel by using their own OpenAI, Azure OpenAI, Anthropic, or Gemini keys. Get started by easily attaching images from the clipboard or dragging them directly into the chat. 
![Screenshot of a chat exchange. A user asks for HTML and CSS for a landing page. The response provides a basic HTML structure with a header, navigation links (Home, About, Contact), and a link to an external CSS file.](https://raw.githubusercontent.com/microsoft/vscode-copilot-vision/refs/heads/main/assets/demo.gif)

### Quick Fixes
Additionally, users can generate or refine alt text for images in markdown, HTML, JSX, or TSX documents with the provided code actions, simplifying the process of incorporating descriptive text for better context and accessibility. Alt text quick fixes work for images in the workspace and with any image URLs. 

![An example markdown document displays a quick fix feature for generating alt text, resulting in the automatic insertion of an alt tag and a value. The user is then prompted with a different quick fix to refine the alt text using an input box. After the user enters and submits their refined description, the alt text is updated accordingly.](https://raw.githubusercontent.com/microsoft/vscode-copilot-vision/refs/heads/main/assets/demo-alt-text.gif)

## Contributed Commands and Settings
### Commands
- Set a Provider and Model.
- Set Current Model's API Key.
- Remove Current Model's API Key.
- Troubleshoot (screenshots the VS Code window and sends it to chat).

### Settings
- `copilot.vision.provider`: The selected provider (currently limted to OpenAI, Anthropic, and Gemini).
- `copilot.vision.model`: The model for the currently selected provider.


# How do I attach images to the chat panel?
1. Copy and Paste an image from the clipboard.
2. With an image in the clipboard, select the `Attach Context` button and select `Image from Clipboard` from the quick pick.
3. Click the `Attach Context` button and select an image in the workspace or `Screenshot Window`.
4. Drag and drop from anywhere outside VS Code into the chat panel.
5. From the command palette, select `Copilot Vision: Troubleshoot`. This is very useful for screen reader and beginner users for diagnosing issues in one's workspace.

## Trademarks
This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow Microsoft's Trademark & Brand Guidelines. Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
