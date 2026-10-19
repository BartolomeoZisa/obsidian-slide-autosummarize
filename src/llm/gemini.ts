/**
 * Gemini provider via the Generative Language REST API.
 * No SDK dependency — plain fetch, so it bundles cleanly in Obsidian.
 * Docs: https://ai.google.dev/api/generate-content
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

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export const GEMINI_DEFAULT_MODELS = [
	"gemini-3.5-flash-lite",
	"gemma-4-31b-it",
	"gemini-2.0-flash",
	"gemini-1.5-pro",
	"gemma-3-27b-it",
];

export class GeminiProvider implements LLMProvider {
	readonly id = "gemini";
	readonly displayName = "Google Gemini";
	readonly supportsVision = true;
	readonly defaultModels = GEMINI_DEFAULT_MODELS;

	validateConfig(config: ProviderConfig): void {
		if (!config.apiKey || !config.apiKey.trim()) {
			throw new Error(
				"Gemini API key is missing. Set it in Settings → Slide Autosummarize (get one at https://aistudio.google.com/apikey).",
			);
		}
		if (!config.model.trim()) throw new Error("Gemini model name is empty.");
	}

	async summarizeSlides(
		slides: SlideContent[],
		instructions: string,
		config: ProviderConfig,
		options?: ChatOptions,
	): Promise<string> {
		this.validateConfig(config);
		const timeoutMs = config.timeoutMs ?? 180_000;
		const model = encodeURIComponent(config.model.trim());
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(config.apiKey!.trim())}`;

		const parts: unknown[] = [{ text: instructions }];
		for (const s of slides) {
			parts.push({ text: buildTextPartForSlide(s.pageNumber, s.text) });
			if (s.imageBase64) {
				parts.push({
					inlineData: {
						mimeType: s.imageMimeType ?? "image/png",
						data: s.imageBase64,
					},
				});
			}
		}

		const generationConfig: Record<string, unknown> = {
			maxOutputTokens: options?.maxTokens ?? config.maxTokens ?? 8192,
		};
		const temperature = options?.temperature ?? config.temperature;
		if (temperature !== undefined) generationConfig.temperature = temperature;

		const body = {
			system_instruction: {
				parts: [
					{
						text: options?.systemPrompt ??
							"You are a precise lecture-slide explainer writing Obsidian Markdown with valid LaTeX.",
					},
				],
			},
			contents: [{ role: "user", parts }],
			generationConfig,
		};

		const res = await fetchWithRetry(
			url,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			{
				timeoutMs,
				maxRetries: config.maxRetries ?? 5,
				providerLabel: "Gemini",
				onRetry: options?.onRetry,
			},
		);
		await throwIfBad(res, "Gemini");
		const json = (await res.json()) as {
			candidates?: Array<{
				content?: { parts?: Array<{ text?: string }> };
			}>;
		};
		const text = (json.candidates?.[0]?.content?.parts ?? [])
			.map((p) => p.text ?? "")
			.join("")
			.trim();
		if (!text) throw new Error("Gemini returned an empty response.");
		return text;
	}
}
