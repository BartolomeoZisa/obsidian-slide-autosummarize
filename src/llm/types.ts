/**
 * Modular LLM provider interface.
 *
 * Each slide (or batch of slides) is passed as multimodal content:
 * extracted text + an optional rendered page image (base64 PNG/JPEG).
 * Providers implement `chat()`; the summarizer orchestrates batching,
 * retries and markdown assembly — so adding a new API = one new file
 * implementing this interface + registering it in factory.ts.
 */

/** One slide's worth of input for the LLM. */
export interface SlideContent {
	pageNumber: number;
	/** Text extracted from the PDF page (may be empty for scanned slides). */
	text: string;
	/** Base64-encoded image (no data: prefix). Undefined when images disabled/failed. */
	imageBase64?: string;
	/** MIME type of imageBase64. */
	imageMimeType?: string;
	/** Pixel dimensions of the image the model sees (for bbox conversion). */
	imageWidth?: number;
	imageHeight?: number;
}

export interface ChatOptions {
	/** 0..2 depending on provider. */
	temperature?: number;
	maxTokens?: number;
	systemPrompt?: string;
	/** Called with 0..1 progress for long batched jobs. */
	onProgress?: (fraction: number, label: string) => void;
	/** Called before each automatic retry (transient 429/5xx or network error). */
	onRetry?: (info: RetryInfo) => void;
}

export interface ProviderConfig {
	apiKey?: string;
	model: string;
	/** For Ollama / OpenAI-compatible endpoints. e.g. http://localhost:11434 */
	baseUrl?: string;
	temperature?: number;
	maxTokens?: number;
	/** Extra request timeout ms. */
	timeoutMs?: number;
	/** Retries per call on transient failures (429/5xx, timeouts). Default 5. */
	maxRetries?: number;
}

export interface RetryInfo {
	/** 1-based number of the retry about to happen. */
	retry: number;
	maxRetries: number;
	waitMs: number;
	/** e.g. "HTTP 503" or a network error message. */
	reason: string;
}

export interface RetryOptions {
	timeoutMs?: number;
	maxRetries?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	providerLabel?: string;
	onRetry?: (info: RetryInfo) => void;
}

export interface LLMProvider {
	readonly id: string;
	readonly displayName: string;
	/** Does this provider accept page images? (text fallback otherwise) */
	readonly supportsVision: boolean;
	/** Curated model list shown in settings; first entry is the default. */
	readonly defaultModels: string[];
	/** Validate config before running; throw with user-friendly message. */
	validateConfig(config: ProviderConfig): void;
	/**
	 * Summarize one batch of slides. Must return Markdown covering exactly
	 * the given slides (the orchestrator concatenates batches).
	 */
	summarizeSlides(
		slides: SlideContent[],
		instructions: string,
		config: ProviderConfig,
		options?: ChatOptions,
	): Promise<string>;
}

/** Shared fetch helper with timeout + clean error messages. */
export async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs = 120_000,
): Promise<Response> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, { ...init, signal: ctrl.signal });
		return res;
	} catch (e) {
		if ((e as Error).name === "AbortError") {
			throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
		}
		throw e;
	} finally {
		clearTimeout(t);
	}
}

export async function throwIfBad(
	res: Response,
	providerLabel: string,
): Promise<void> {
	if (res.ok) return;
	let body = "";
	try {
		body = await res.text();
	} catch {
		/* ignore */
	}
	const snippet = body.slice(0, 800);
	throw new Error(
		`${providerLabel} request failed (HTTP ${res.status}): ${snippet || res.statusText}`,
	);
}

function isTransientStatus(status: number): boolean {
	return (
		status === 429 || status === 500 || status === 502 || status === 503 || status === 504
	);
}

function parseRetryAfterMs(res: Response, fallbackMs: number, maxMs: number): number {
	try {
		const raw = res.headers?.get?.("retry-after");
		if (raw) {
			const secs = Number(raw);
			if (Number.isFinite(secs) && secs >= 0) {
				return Math.min(Math.max(0, secs * 1000), maxMs);
			}
			const when = Date.parse(raw);
			if (Number.isFinite(when)) {
				return Math.min(Math.max(0, when - Date.now()), maxMs);
			}
		}
	} catch {
		/* ignore malformed headers */
	}
	return Math.min(Math.max(0, fallbackMs), maxMs);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch with automatic retry on transient failures: HTTP 429/500/502/503/504
 * (e.g. Gemini 503 "high demand"), timeouts and network errors.
 * Exponential backoff (baseDelayMs * 2^attempt + jitter), honoring the
 * server's Retry-After header, capped at maxDelayMs.
 *
 * Returns the response when it is OK or the failure is NOT transient
 * (call throwIfBad on it as before). Throws only when retries are
 * exhausted or the request itself never completed.
 */
export async function fetchWithRetry(
	url: string,
	init: RequestInit,
	opts: RetryOptions = {},
): Promise<Response> {
	const timeoutMs = opts.timeoutMs ?? 120_000;
	const maxRetries = opts.maxRetries ?? 5;
	const baseDelayMs = opts.baseDelayMs ?? 2000;
	const maxDelayMs = opts.maxDelayMs ?? 60_000;
	const label = opts.providerLabel ?? "LLM";

	for (let attempt = 0; ; attempt++) {
		let res: Response;
		try {
			res = await fetchWithTimeout(url, init, timeoutMs);
		} catch (e) {
			const reason = e instanceof Error ? e.message : String(e);
			if (attempt >= maxRetries) {
				throw new Error(
					`${label} request failed after ${attempt + 1} attempt(s): ${reason}`,
				);
			}
			const waitMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs) + Math.random() * 1000;
			opts.onRetry?.({
				retry: attempt + 1,
				maxRetries,
				waitMs: Math.round(waitMs),
				reason,
			});
			await sleep(waitMs);
			continue;
		}

		if (res.ok) return res;

		const transient = isTransientStatus(res.status);
		if (!transient) return res; // permanent (4xx etc.) — caller reports it
		if (attempt >= maxRetries) {
			let snippet = "";
			try {
				snippet = (await res.text()).slice(0, 800);
			} catch {
				/* ignore */
			}
			throw new Error(
				`${label} request failed after ${attempt + 1} attempt(s) (last HTTP ${res.status}): ${snippet || res.statusText}`,
			);
		}
		const backoff = baseDelayMs * 2 ** attempt + Math.random() * 1000;
		const waitMs = parseRetryAfterMs(res, backoff, maxDelayMs);
		opts.onRetry?.({
			retry: attempt + 1,
			maxRetries,
			waitMs: Math.round(waitMs),
			reason: `HTTP ${res.status}`,
		});
		await sleep(waitMs);
	}
}
