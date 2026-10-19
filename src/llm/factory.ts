/**
 * Provider registry — the single place to add a new LLM API.
 * 1. Create src/llm/<my-provider>.ts implementing LLMProvider.
 * 2. Register it here.
 * 3. Done: settings UI, validation and the summarizer pick it up automatically.
 */
import { LLMProvider } from "./types";
import { GeminiProvider } from "./gemini";
import {
	OpenAICompatibleProvider,
	createCustomProvider,
	createOllamaProvider,
	createOpenAIProvider,
} from "./openai-compatible";
import { AnthropicProvider } from "./anthropic";

export type ProviderId = "gemini" | "openai" | "anthropic" | "ollama" | "custom";

export function allProviders(): LLMProvider[] {
	return [
		new GeminiProvider(),
		createOpenAIProvider(),
		new AnthropicProvider(),
		createOllamaProvider(),
		createCustomProvider(),
	];
}

export function getProvider(id: string): LLMProvider {
	const found = allProviders().find((p) => p.id === id);
	if (!found) throw new Error(`Unknown LLM provider: ${id}`);
	return found;
}

/** For OpenAICompatibleProvider flavours only — narrows typing for settings. */
export function isOpenAICompatible(id: string): boolean {
	return id === "openai" || id === "ollama" || id === "custom";
}

export type { LLMProvider, OpenAICompatibleProvider };
