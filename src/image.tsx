import {
	BasePromptElementProps,
	PromptElement,
	PromptSizing,
	UserMessage
} from '@vscode/prompt-tsx';
import { ChatVariablesCollection } from './chatVariablesCollective';
import { ChatReferenceBinaryData } from 'vscode';

export interface ChatVariablesAndQueryProps extends BasePromptElementProps {
	query: string;
	chatVariables: ChatVariablesCollection;
	/**
	 * By default, the chat variables are reversed. Set this to true to maintain the variable order.
	 */
	maintainOrder?: boolean;
	includeFilepath?: boolean;
}

export class Image extends PromptElement<ChatVariablesAndQueryProps, void> {
	async render(state: void, sizing: PromptSizing) {
		const chatVariables = this.props.chatVariables;
		const promptElements: PromptElement[] = [];
		for (const { uniqueName: variableName, value: variableValue } of chatVariables) {
			if (typeof variableValue === 'object') {
				const variable = variableValue as ChatReferenceBinaryData;
				const buffer = await variable.data();
				// 	promptElements.push(
				// 		<Image query='test' mimeType={variable.mimeType} data={variable.data}>
				// 		</Image>);
				// }
			}
		}


		console.log(chatVariables);
		return (
			<>
				<UserMessage>
					To include image via prompt.tsx. 
				</UserMessage>
			</>
		);
	}
}
