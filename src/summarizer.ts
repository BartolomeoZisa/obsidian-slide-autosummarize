import { TFile, Vault, normalizePath } from "obsidian";
import {
	bytesToBase64,
	extractPdfSlides,
	ExtractedPage,
	TextBox,
} from "./pdf";
import { getProvider, ProviderId } from "./llm/factory";
import { DEFAULT_GEMINI_MODEL } from "./llm/gemini";
import { ProviderConfig, SlideContent } from "./llm/types";
import {
	DEFAULT_SYSTEM_PROMPT,
	buildBatchPrompt,
	buildPriorNotesSection,
} from "./llm/prompt";
import {
	applyFigureEmbeds,
	boxToPixels,
	cropPng,
	fitCropAroundText,
	parseFigureReferences,
} from "./figures";

export interface SummarizerSettings {
	provider: ProviderId;
	// per-provider credentials/models
	geminiApiKey: string;
	geminiModel: string;
	openaiApiKey: string;
	openaiModel: string;
	anthropicApiKey: string;
	anthropicModel: string;
	ollamaBaseUrl: string;
	ollamaModel: string;
	customBaseUrl: string;
	customApiKey: string;
	customModel: string;
	// pipeline
	outputFolder: string;
	imageFolder: string;
	includeImages: boolean;
	/** Embed the LLM-picked figure crops in the note (full slides never). */
	embedImagesInNote: boolean;
	/** Also save full slide renders to disk (not embedded, for reference). */
	saveFullPages: boolean;
	pagesPerBatch: number;
	renderScale: number;
	/** When true (default), temperature is omitted from API calls. */
	useDefaultTemperature: boolean;
	/** Manual temperature, used only when useDefaultTemperature is false. */
	temperature: number;
	maxTokens: number;
	customInstructions: string;
	autoSummarizeOnCreate: boolean;
	/** Retries per batch on transient API errors (429/5xx, timeouts). 0 = fail immediately. */
	maxRetries: number;
}

export const DEFAULT_SETTINGS: SummarizerSettings = {
	provider: "gemini",
	geminiApiKey: "",
	geminiModel: DEFAULT_GEMINI_MODEL,
	openaiApiKey: "",
	openaiModel: "gpt-4o-mini",
	anthropicApiKey: "",
	anthropicModel: "claude-sonnet-4-20250514",
	ollamaBaseUrl: "http://localhost:11434/v1",
	ollamaModel: "qwen2.5vl",
	customBaseUrl: "http://localhost:11434/v1",
	customApiKey: "",
	customModel: "",
	outputFolder: "Summaries",
	imageFolder: "Attachments/slides",
	includeImages: true,
	embedImagesInNote: true,
	saveFullPages: false,
	pagesPerBatch: 3,
	renderScale: 2.0,
	useDefaultTemperature: true,
	temperature: 0.3,
	maxTokens: 8192,
	customInstructions: "",
	autoSummarizeOnCreate: false,
	maxRetries: 5,
};

export function providerConfigFor(
	s: SummarizerSettings,
): { providerId: ProviderId; config: ProviderConfig } {
	const temperature = s.useDefaultTemperature ? undefined : s.temperature;
	switch (s.provider) {
		case "gemini":
			return {
				providerId: "gemini",
				config: {
					apiKey: s.geminiApiKey,
					model: s.geminiModel || DEFAULT_GEMINI_MODEL,
					temperature,
					maxTokens: s.maxTokens,
				},
			};
		case "openai":
			return {
				providerId: "openai",
				config: {
					apiKey: s.openaiApiKey,
					model: s.openaiModel || "gpt-4o-mini",
					baseUrl: "https://api.openai.com/v1",
					temperature,
					maxTokens: Math.min(s.maxTokens, 16384),
				},
			};
		case "anthropic":
			return {
				providerId: "anthropic",
				config: {
					apiKey: s.anthropicApiKey,
					model: s.anthropicModel || "claude-sonnet-4-20250514",
					temperature,
					maxTokens: Math.min(s.maxTokens, 8192),
				},
			};
		case "ollama":
			return {
				providerId: "ollama",
				config: {
					model: s.ollamaModel || "qwen2.5vl",
					baseUrl: s.ollamaBaseUrl || "http://localhost:11434/v1",
					temperature,
					maxTokens: s.maxTokens,
					timeoutMs: 600_000,
				},
			};
		case "custom":
			return {
				providerId: "custom",
				config: {
					apiKey: s.customApiKey,
					model: s.customModel,
					baseUrl: s.customBaseUrl,
					temperature,
					maxTokens: s.maxTokens,
					timeoutMs: 300_000,
				},
			};
	}
}

export interface SummarizeProgress {
	phase: "extract" | "summarize" | "write";
	done: number;
	total: number;
	label: string;
}

function chunk<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	const n = Math.max(1, Math.floor(size) || 1);
	for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
	return out;
}

function sanitizeBase(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, "_").trim() || "slides";
}

export async function summarizePdfFile(
	vault: Vault,
	pdfFile: TFile,
	settings: SummarizerSettings,
	onProgress?: (p: SummarizeProgress) => void,
): Promise<string> {
	const { providerId, config } = providerConfigFor(settings);
	config.maxRetries = settings.maxRetries;
	const provider = getProvider(providerId);
	provider.validateConfig(config);

	// 1. Read + extract
	onProgress?.({ phase: "extract", done: 0, total: 1, label: "Reading PDF…" });
	const bin = await vault.readBinary(pdfFile);
	const { pages, numPages } = await extractPdfSlides(bin, {
		renderScale: settings.renderScale,
		renderImages: settings.includeImages,
		onProgress: (done, total) =>
			onProgress?.({ phase: "extract", done, total, label: `Rendering slide ${done}/${total}` }),
	});
	if (pages.length === 0) throw new Error("PDF has no pages to summarize.");

	// 2. Optionally stash full page renders (reference only, never embedded)
	const base = sanitizeBase(pdfFile.basename);
	const imgDir = normalizePath(`${settings.imageFolder}/${base}`);
	const renders = new Map<
		number,
		{
			bytes: Uint8Array;
			width: number;
			height: number;
			textBoxes: TextBox[];
		}
	>();
	for (const p of pages) {
		if (p.imageBytes && p.imageWidth && p.imageHeight) {
			renders.set(p.pageNumber, {
				bytes: p.imageBytes,
				width: p.imageWidth,
				height: p.imageHeight,
				textBoxes: p.textBoxes ?? [],
			});
		}
	}
	if (settings.saveFullPages && renders.size > 0) {
		await ensureFolder(vault, imgDir);
		for (const p of pages) {
			const r = renders.get(p.pageNumber);
			if (!r) continue;
			const fname = `${base}-p${String(p.pageNumber).padStart(2, "0")}.png`;
			await writeBinary(vault, normalizePath(`${imgDir}/${fname}`), r.bytes);
		}
	}

	// 3. Build LLM inputs (dimensions included so bboxes map back to pixels)
	const slides: SlideContent[] = pages.map((p: ExtractedPage) => ({
		pageNumber: p.pageNumber,
		text: p.text,
		imageBase64:
			settings.includeImages && p.imageBytes
				? bytesToBase64(p.imageBytes)
				: undefined,
		imageMimeType: "image/png",
		imageWidth: p.imageWidth,
		imageHeight: p.imageHeight,
	}));

	// 4. Batch through the LLM, feeding prior notes back for consistency
	const batches = chunk(slides, Math.max(1, settings.pagesPerBatch));
	const parts: string[] = [];
	let priorNotes = "";
	let n = 0;
	for (const batch of batches) {
		n++;
		const start = batch[0].pageNumber;
		const end = batch[batch.length - 1].pageNumber;
		onProgress?.({
			phase: "summarize",
			done: n - 1,
			total: batches.length,
			label: `Summarizing slides ${start}–${end} (batch ${n}/${batches.length})…`,
		});
		let prompt = buildBatchPrompt(start, end, settings.customInstructions);
		const priorSection = buildPriorNotesSection(priorNotes);
		if (priorSection) prompt += `\n\n${priorSection}`;
		const md = await provider.summarizeSlides(batch, prompt, config, {
			systemPrompt: DEFAULT_SYSTEM_PROMPT,
			temperature: settings.useDefaultTemperature ? undefined : settings.temperature,
			maxTokens: settings.maxTokens,
			onRetry: (r) =>
				onProgress?.({
					phase: "summarize",
					done: n - 1,
					total: batches.length,
					label: `Batch ${n}/${batches.length} hit ${r.reason} — retry ${r.retry}/${r.maxRetries} in ${Math.max(1, Math.round(r.waitMs / 1000))}s…`,
				}),
		});
		const trimmed = md.trim();
		parts.push(trimmed);
		priorNotes += (priorNotes ? "\n\n" : "") + trimmed;
		onProgress?.({
			phase: "summarize",
			done: n,
			total: batches.length,
			label: `Summarized batch ${n}/${batches.length}`,
		});
	}

	// 5. Crop LLM-picked figures, embed only the crops
	let body = parts.join("\n\n");
	if (settings.includeImages && settings.embedImagesInNote && renders.size > 0) {
		onProgress?.({
			phase: "summarize",
			done: batches.length,
			total: batches.length,
			label: "Cropping figures…",
		});
		await ensureFolder(vault, imgDir);
		const refs = parseFigureReferences(body);
		const embeds = new Map<number, string>();
		const figCount = new Map<number, number>();
		for (const ref of refs) {
			const r = renders.get(ref.slide);
			if (!r) {
				// Page had no render (text-only fallback): drop the directive.
				embeds.set(ref.lineIndex, "");
				continue;
			}
			// Grow the box to swallow any text it would otherwise slice.
			// null means the figure cannot be taken cleanly: drop it.
			const safe = fitCropAroundText(
				boxToPixels(ref, r.width, r.height),
				r.textBoxes,
				r.width,
				r.height,
			);
			if (!safe) {
				embeds.set(ref.lineIndex, "");
				continue;
			}
			let crop: Uint8Array;
			try {
				crop = await cropPng(r.bytes, safe);
			} catch (e) {
				console.warn(
					`slide-autosummarize: crop failed (slide ${ref.slide}), dropping figure`,
					e,
				);
				embeds.set(ref.lineIndex, "");
				continue;
			}
			const k = (figCount.get(ref.slide) ?? 0) + 1;
			figCount.set(ref.slide, k);
			const fname = `${base}-p${String(ref.slide).padStart(2, "0")}-fig${k}.png`;
			const fpath = normalizePath(`${imgDir}/${fname}`);
			await writeBinary(vault, fpath, crop);
			const caption = ref.caption ? `\n*${ref.caption}*` : "";
			embeds.set(ref.lineIndex, `![[${fpath}]]${caption}`);
		}
		body = applyFigureEmbeds(body, embeds);
	} else {
		// No figure embeds wanted (or no renders): drop leftover FIGURE lines.
		const drop = new Map<number, string>();
		for (const ref of parseFigureReferences(body)) drop.set(ref.lineIndex, "");
		body = applyFigureEmbeds(body, drop);
	}
	// release render memory
	renders.clear();
	for (const p of pages) delete p.imageBytes;

	// 6. Assemble note
	const now = new Date().toISOString();
	const note = [
		"---",
		`source-pdf: "[[${pdfFile.path}]]"`,
		`generated: ${now}`,
		`provider: ${providerId}`,
		`model: ${config.model}`,
		`slides: ${numPages}`,
		"---",
		"",
		`# ${base} — Slide Summary`,
		"",
		`> Auto-generated class notes from \`[[${pdfFile.path}]]\` (${numPages} slides) with ${provider.displayName} (\`${config.model}\`) on ${now.slice(0, 10)}.`,
		">",
		"> Equations are in LaTeX: inline `$…$`, display `$$…$$`. Figures were picked and cropped automatically.",
		"",
		body,
		"",
	].join("\n");

	// 7. Write note
	onProgress?.({ phase: "write", done: 0, total: 1, label: "Writing note…" });
	const outDir = normalizePath(settings.outputFolder);
	await ensureFolder(vault, outDir);
	const outPath = normalizePath(`${outDir}/${base}.md`);
	// Use the vault API (not vault.adapter) so the file is indexed and can be
	// opened immediately after creation.
	const existingNote = vault.getAbstractFileByPath(outPath);
	if (existingNote instanceof TFile) {
		await vault.modify(existingNote, note);
	} else {
		await vault.create(outPath, note);
	}
	onProgress?.({ phase: "write", done: 1, total: 1, label: "Done" });
	return outPath;
}

async function ensureFolder(vault: Vault, dir: string): Promise<void> {
	const norm = normalizePath(dir);
	if (!norm || norm === "/") return;
	if (vault.getAbstractFileByPath(norm)) return;
	try {
		await vault.createFolder(norm);
	} catch (e) {
		// Folder may have been created concurrently; ignore only that case.
		if (!vault.getAbstractFileByPath(norm)) throw e;
	}
}

async function writeBinary(
	vault: Vault,
	path: string,
	bytes: Uint8Array,
): Promise<void> {
	const existing = vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await vault.modifyBinary(existing, bytes.buffer as ArrayBuffer);
		return;
	}
	// Leftover non-indexed file (e.g. from an older version): remove it first
	// so createBinary does not fail on a path that exists on disk.
	if (await vault.adapter.exists(path)) await vault.adapter.remove(path);
	await vault.createBinary(path, bytes.buffer as ArrayBuffer);
}
