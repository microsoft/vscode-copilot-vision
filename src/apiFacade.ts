/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Anthropic from "@anthropic-ai/sdk";
import { ContentBlock } from "@anthropic-ai/sdk/resources/messages.mjs";
import { TextBlockParam, ImageBlockParam, TextBlock } from "@anthropic-ai/sdk/src/resources/messages.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI, { AzureOpenAI } from "openai";
import type { ChatCompletionContentPart, ChatCompletionUserMessageParam } from "openai/resources/index.mjs";
import { ChatModel, ProviderType } from "./extension";

export interface ApiFacade {
	create(apiKey: string, request: string, provider: ChatModel, content: Buffer[], mimeType: string): Promise<string[]>;
}

export class AnthropicApi implements ApiFacade {
	async create(apiKey: string, request: string, provider: ChatModel, content: Buffer[], mimeType: string): Promise<string[]> {
		try {
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

			return result.content.map((content: ContentBlock) => content.type === 'text' ? (content as TextBlock).text : '');
		} catch (error) {
			console.error('Error in AnthropicApi:', error);
			throw error;
		}
	}
}

export class OpenAIApi implements ApiFacade {
	async create(apiKey: string, request: string, provider: ChatModel, content: Buffer[], mimeType: string): Promise<string[]> {
		try {
			if (apiKey === undefined) {
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

			const result = await openAi.chat.completions.create({
				model: provider.model, // gpt-4o
				messages: [
					{ role: 'user', content: prompts }
				]
			});

			const messages = [];

			for (const choice of result.choices) {
				if (choice.message.content) {
					messages.push(choice.message.content);
				}
			}
			return messages;
		} catch (error) {
			console.error('Error in OpenAIApi:', error);
			throw error;
		}
	}
}

export class GeminiApi implements ApiFacade {
	async create(apiKey: string, request: string, provider: ChatModel, content: Buffer[], mimeType: string): Promise<string[]> {
		try {
			function getFilePart(buffer: Buffer) {
				return {
					inlineData: { data: buffer.toString('base64'), mimeType }
				};
			}

			// for multiple images
			const imageParts = [];

			for (const data of content) {
				imageParts.push(getFilePart(data));
			}

			const genAI = new GoogleGenerativeAI(apiKey);
			const model = genAI.getGenerativeModel({ model: provider.model }); // 'gemini-1.5-flash'
			const result = await model.generateContent([request, ...imageParts]);

			const messages = [];

			for (const part of result.response.text()) {
				messages.push(part);
			}
			return messages;
		} catch (error) {
			console.error('Error in GeminiApi:', error);
			throw error;
		}
	}
}

export class AzureOpenAIApi implements ApiFacade {
	async create(apiKey: string, request: string, provider: ChatModel, content: Buffer[], mimeType: string): Promise<string[]> {
		try {
			// EXAMPLE OF USING AZURE OPENAI
			const endpoint = process.env["AZURE_ENDPOINT"] || "https://vscode-openai.openai.azure.com/";
			const apiVersion = "2024-05-01-preview";
			const model = provider.model; // gpt-4o-mini or Gpt4
			const client = new AzureOpenAI({ endpoint, apiVersion, deployment: model, apiKey });

			const prompts: ChatCompletionUserMessageParam[] = [
				{ role: 'user', content: request },
			];

			for (const data of content) {
				const base64 = data.toString('base64');
				prompts.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'auto' } }] });
			}

			const result = await client.chat.completions.create({
				messages: prompts,
				model,
				max_tokens: 8192,
				temperature: 0.7,
				top_p: 0.95,
				frequency_penalty: 0,
				presence_penalty: 0
			});

			const messages = [];
			for (const choice of result.choices) {
				if (choice.message.content) {
					messages.push(choice.message.content);
				}
			}

			return messages;
		} catch (error) {
			console.error('Error in AzureOpenAIApi:', error);
			throw error;
		}
	}
}

export function getApi(type: ProviderType): ApiFacade {
	switch (type) {
		case ProviderType.Gemini:
			return new GeminiApi();
		case ProviderType.Anthropic:
			return new AnthropicApi();
		case ProviderType.OpenAI:
			return new OpenAIApi();
		case ProviderType.AzureOpenAI:
			throw new Error('Azure Open AI does not currently support vision.');
		default:
			throw new Error('Invalid model type');
	}
}
