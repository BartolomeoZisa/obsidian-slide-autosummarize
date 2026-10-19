/**
 * Anthropic Messages API provider (plain fetch).
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

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

export const ANTHROPIC_DEFAULT_MODELS = [
	"claude-sonnet-4-20250514",
	"claude-opus-4-20250514",
	"claude-3-5-sonnet-20241022",
	"claude-3-5-haiku-20241022",
];
const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicProvider implements LLMProvider {
	readonly id = "anthropic";
	readonly displayName = "Anthropic Claude";
	readonly supportsVision = true;
	readonly defaultModels = ANTHROPIC_DEFAULT_MODELS;

	validateConfig(config: ProviderConfig): void {
		if (!config.apiKey?.trim()) {
			throw new Error(
				"Anthropic API key is missing. Set it in Settings → Slide Autosummarize.",
			);
		}
		if (!config.model.trim()) throw new Error("Anthropic model name is empty.");
	}

	async summarizeSlides(
		slides: SlideContent[],
		instructions: string,
		config: ProviderConfig,
		options?: ChatOptions,
	): Promise<string> {
		this.validateConfig(config);
		const timeoutMs = config.timeoutMs ?? 180_000;

		const content: unknown[] = [{ type: "text", text: instructions }];
		for (const s of slides) {
			content.push({
				type: "text",
				text: buildTextPartForSlide(s.pageNumber, s.text),
			});
			if (s.imageBase64) {
				content.push({
					type: "image",
					source: {
						type: "base64",
						media_type: s.imageMimeType ?? "image/png",
						data: s.imageBase64,
					},
				});
			}
		}

		const body: Record<string, unknown> = {
			model: config.model.trim(),
			max_tokens: options?.maxTokens ?? config.maxTokens ?? 4096,
			system:
				options?.systemPrompt ??
				"You are a precise lecture-slide explainer writing Obsidian Markdown with valid LaTeX.",
			messages: [{ role: "user", content }],
		};
		const temperature = options?.temperature ?? config.temperature;
		if (temperature !== undefined) body.temperature = temperature;

		const res = await fetchWithRetry(
			"https://api.anthropic.com/v1/messages",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": config.apiKey!.trim(),
					"anthropic-version": ANTHROPIC_VERSION,
					"anthropic-dangerous-direct-browser-access": "true",
				},
				body: JSON.stringify(body),
			},
			{
				timeoutMs,
				maxRetries: config.maxRetries ?? 5,
				providerLabel: "Anthropic",
				onRetry: options?.onRetry,
			},
		);
		await throwIfBad(res, "Anthropic");
		const json = (await res.json()) as {
			content?: Array<{ type?: string; text?: string }>;
		};
		const text = (json.content ?? [])
			.filter((b) => b.type === "text")
			.map((b) => b.text ?? "")
			.join("")
			.trim();
		if (!text) throw new Error("Anthropic returned an empty response.");
		return text;
	}
}
