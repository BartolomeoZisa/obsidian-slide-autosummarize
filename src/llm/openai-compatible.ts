/**
 * OpenAI-compatible chat provider.
 * Covers: OpenAI itself, Ollama (OpenAI endpoint), vLLM, LM Studio,
 * OpenRouter, Mistral, Together, etc. — anything speaking
 * POST {baseUrl}/chat/completions with OpenAI message format.
 *
 * Vision: sent as image_url data-URLs. Text-only models simply ignore
 * images poorly, so set supportsVision=true but the plugin lets users
 * disable images (then only text is sent).
 */
import {
	ChatOptions,
	LLMProvider,
	ProviderConfig,
	SlideContent,
	fetchWithRetry,
	throwIfBad,
} from "./types";
import { buildTextPartForSlide } from "./prompt";

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5vl";
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export class OpenAICompatibleProvider implements LLMProvider {
	readonly id: string;
	readonly displayName: string;
	readonly supportsVision = true;
	readonly defaultModels: string[];
	private readonly defaultBaseUrl: string;
	private readonly defaultModel: string;
	private readonly apiKeyRequired: boolean;

	constructor(opts: {
		id: string;
		displayName: string;
		defaultBaseUrl: string;
		defaultModel: string;
		defaultModels: string[];
		apiKeyRequired: boolean;
	}) {
		this.id = opts.id;
		this.displayName = opts.displayName;
		this.defaultBaseUrl = opts.defaultBaseUrl;
		this.defaultModel = opts.defaultModel;
		this.defaultModels = opts.defaultModels;
		this.apiKeyRequired = opts.apiKeyRequired;
	}

	validateConfig(config: ProviderConfig): void {
		if (this.apiKeyRequired && !config.apiKey?.trim()) {
			throw new Error(
				`${this.displayName} API key is missing. Set it in Settings → Slide Autosummarize.`,
			);
		}
		const base = (config.baseUrl || this.defaultBaseUrl).trim();
		if (!base) throw new Error(`${this.displayName} base URL is empty.`);
		const model = (config.model || this.defaultModel).trim();
		if (!model) throw new Error(`${this.displayName} model name is empty.`);
	}

	async summarizeSlides(
		slides: SlideContent[],
		instructions: string,
		config: ProviderConfig,
		options?: ChatOptions,
	): Promise<string> {
		this.validateConfig(config);
		const baseUrl = (config.baseUrl || this.defaultBaseUrl).trim();
		const url = joinUrl(baseUrl, "/chat/completions");
		const timeoutMs = config.timeoutMs ?? 180_000;

		const userContent: unknown[] = [{ type: "text", text: instructions }];
		for (const s of slides) {
			userContent.push({
				type: "text",
				text: buildTextPartForSlide(s.pageNumber, s.text),
			});
			if (s.imageBase64) {
				userContent.push({
					type: "image_url",
					image_url: {
						url: `data:${s.imageMimeType ?? "image/png"};base64,${s.imageBase64}`,
						detail: "high",
					},
				});
			}
		}

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (config.apiKey?.trim()) headers["Authorization"] = `Bearer ${config.apiKey.trim()}`;

		const body: Record<string, unknown> = {
			model: config.model.trim() || this.defaultModel,
			messages: [
				{
					role: "system",
					content:
						options?.systemPrompt ??
						"You are a precise lecture-slide explainer writing Obsidian Markdown with valid LaTeX.",
				},
				{ role: "user", content: userContent },
			],
			max_tokens: options?.maxTokens ?? config.maxTokens ?? 4096,
		};
		const temperature = options?.temperature ?? config.temperature;
		if (temperature !== undefined) body.temperature = temperature;

		const res = await fetchWithRetry(
			url,
			{ method: "POST", headers, body: JSON.stringify(body) },
			{
				timeoutMs,
				maxRetries: config.maxRetries ?? 5,
				providerLabel: this.displayName,
				onRetry: options?.onRetry,
			},
		);
		await throwIfBad(res, this.displayName);
		const json = (await res.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const text = (json.choices?.[0]?.message?.content ?? "").trim();
		if (!text) throw new Error(`${this.displayName} returned an empty response.`);
		return text;
	}
}

/** Pre-built flavours sharing the same transport. */
export function createOpenAIProvider(): OpenAICompatibleProvider {
	return new OpenAICompatibleProvider({
		id: "openai",
		displayName: "OpenAI",
		defaultBaseUrl: "https://api.openai.com/v1",
		defaultModel: DEFAULT_OPENAI_MODEL,
		defaultModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
		apiKeyRequired: true,
	});
}

export function createOllamaProvider(): OpenAICompatibleProvider {
	return new OpenAICompatibleProvider({
		id: "ollama",
		displayName: "Ollama (local)",
		defaultBaseUrl: DEFAULT_OLLAMA_BASE_URL,
		defaultModel: DEFAULT_OLLAMA_MODEL,
		defaultModels: ["qwen2.5vl", "llava", "gemma3", "qwen3", "llama3.1"],
		apiKeyRequired: false,
	});
}

export function createCustomProvider(): OpenAICompatibleProvider {
	return new OpenAICompatibleProvider({
		id: "custom",
		displayName: "Custom OpenAI-compatible",
		defaultBaseUrl: "http://localhost:11434/v1",
		defaultModel: DEFAULT_OLLAMA_MODEL,
		defaultModels: [],
		apiKeyRequired: false,
	});
}
