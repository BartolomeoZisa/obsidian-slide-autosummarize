/**
 * PDF slide extraction.
 * - Text per page via pdf.js getTextContent (always attempted).
 * - Page render to PNG via pdf.js + <canvas> (best effort; falls back to
 *   text-only if rendering fails — e.g. worker unavailable).
 */

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

type PdfjsModule = typeof import("pdfjs-dist");

/** Axis-aligned box in rendered-image pixel coordinates. */
export interface TextBox {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface ExtractedPage {
	pageNumber: number;
	text: string;
	/** Raw PNG bytes of the rendered page, if rendering succeeded. */
	imageBytes?: Uint8Array;
	/** Pixel dimensions of imageBytes (needed for bbox → pixel conversion). */
	imageWidth?: number;
	imageHeight?: number;
	/** Bounding box of every non-empty text run, in rendered-image pixels. */
	textBoxes?: TextBox[];
}

export interface ExtractOptions {
	/** Render scale (PDF points → pixels). 2.0 ≈ 144dpi-ish, good for VLMs. */
	renderScale?: number;
	renderImages?: boolean;
	maxPages?: number;
	onProgress?: (done: number, total: number) => void;
}

async function loadPdfjs(): Promise<PdfjsModule> {
	// Lazy so a broken pdf.js install only fails when actually summarizing.
	const pdfjs: PdfjsModule = await import(
		"pdfjs-dist/legacy/build/pdf.mjs"
	);

	if (!pdfjs.GlobalWorkerOptions.workerSrc) {
		// Worker is bundled as text inside main.js → Blob URL. Fully offline:
		// no extra file to install and no remote code is ever downloaded.
		const workerModule = await import(
			"pdfjs-dist/build/pdf.worker.min.mjs"
		);
		const blob = new Blob([workerModule.default], {
			type: "text/javascript",
		});
		pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
	}
	return pdfjs;
}

export async function extractPdfSlides(
	data: ArrayBuffer,
	opts: ExtractOptions = {},
): Promise<{ pages: ExtractedPage[]; numPages: number }> {
	const renderScale = opts.renderScale ?? 2.0;
	const renderImages = opts.renderImages ?? true;
	const pdfjs = await loadPdfjs();

	let pdf: PDFDocumentProxy;
	try {
		pdf = await openDocument(pdfjs, data);
	} catch (e) {
		if (isWorkerError(e)) {
			throw new Error(
				`Could not start the PDF engine. ${workerHelp()} (${describe(e)})`,
			);
		}
		throw e;
	}
	const totalRequested = opts.maxPages
		? Math.min(opts.maxPages, pdf.numPages)
		: pdf.numPages;

	const pages: ExtractedPage[] = [];
	for (let n = 1; n <= totalRequested; n++) {
		const page: PDFPageProxy = await pdf.getPage(n);
		let text = "";
		let textBoxes: TextBox[] = [];
		try {
			const tc = await page.getTextContent();
			text = tc.items
				.map((it) => ("str" in it ? it.str : ""))
				.join(" ")
				.replace(/\s+/g, " ")
				.trim();
			if (renderImages) {
				textBoxes = collectTextBoxes(
					tc.items,
					page.getViewport({ scale: renderScale }),
					renderScale,
				);
			}
		} catch (e) {
			console.warn(`slide-autosummarize: text extraction failed p.${n}`, e);
		}

		let rendered: { bytes: Uint8Array; width: number; height: number } | undefined;
		if (renderImages) {
			try {
				rendered = await renderPageToPng(page, renderScale);
			} catch (e) {
				console.warn(
					`slide-autosummarize: page render failed p.${n}, continuing text-only`,
					e,
				);
			}
		}

		pages.push({
			pageNumber: n,
			text,
			imageBytes: rendered?.bytes,
			imageWidth: rendered?.width,
			imageHeight: rendered?.height,
			textBoxes,
		});
		try {
			page.cleanup();
		} catch {
			/* ignore */
		}
		opts.onProgress?.(n, totalRequested);
	}

	try {
		await pdf.destroy();
	} catch {
		/* ignore */
	}
	return { pages, numPages: pdf.numPages };
}

/**
 * Text-run boxes in rendered-image pixels. pdf.js gives each run a text-space
 * transform; the viewport matrix maps it to the rendered page.
 */
function collectTextBoxes(
	items: readonly unknown[],
	viewport: { transform: number[] },
	scale: number,
): TextBox[] {
	const boxes: TextBox[] = [];
	for (const raw of items) {
		if (typeof raw !== "object" || raw === null) continue;
		const item = raw as {
			str?: unknown;
			transform?: unknown;
			width?: unknown;
		};
		if (typeof item.str !== "string" || !item.str.trim()) continue;
		if (!Array.isArray(item.transform)) continue;
		const transform = item.transform.map((v) => Number(v));
		if (transform.length < 6 || transform.some((v) => !Number.isFinite(v))) {
			continue;
		}
		const tx = multiply(viewport.transform, transform);
		const fontHeight = Math.hypot(tx[2], tx[3]);
		const width = (typeof item.width === "number" ? item.width : 0) * scale;
		if (!(width > 0.5) || !(fontHeight > 0.5)) continue;
		const left = tx[4];
		const top = tx[5] - fontHeight;
		boxes.push({ x1: left, y1: top, x2: left + width, y2: top + fontHeight });
	}
	return boxes;
}

/** 2×3 affine matrix multiply, matching pdf.js's Util.transform. */
function multiply(m1: number[], m2: number[]): number[] {
	return [
		m1[0] * m2[0] + m1[2] * m2[1],
		m1[1] * m2[0] + m1[3] * m2[1],
		m1[0] * m2[2] + m1[2] * m2[3],
		m1[1] * m2[2] + m1[3] * m2[3],
		m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
		m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
	];
}

function openDocument(
	pdfjs: PdfjsModule,
	data: ArrayBuffer,
): Promise<PDFDocumentProxy> {
	const loadingTask = pdfjs.getDocument({
		data: new Uint8Array(data.slice(0)),
		useWorkerFetch: false,
		isEvalSupported: false,
	});
	return loadingTask.promise;
}

function isWorkerError(e: unknown): boolean {
	const msg = describe(e).toLowerCase();
	return (
		msg.includes("workersrc") ||
		msg.includes("worker") ||
		msg.includes("failed to fetch") ||
		msg.includes("dynamically imported")
	);
}

function describe(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function workerHelp(): string {
	return "The PDF engine's worker is bundled with the plugin; check the developer console (Ctrl+Shift+I) for the underlying error, and make sure Obsidian is not blocking Blob URLs.";
}

async function renderPageToPng(
	page: PDFPageProxy,
	scale: number,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
	const viewport = page.getViewport({ scale });
	const canvas = createEl("canvas");
	canvas.width = Math.floor(viewport.width);
	canvas.height = Math.floor(viewport.height);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D context unavailable");
	const renderTask = page.render({ canvasContext: ctx, viewport });
	await renderTask.promise;
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob((b) => resolve(b), "image/png"),
	);
	if (!blob) throw new Error("canvas.toBlob returned null");
	const buf = await blob.arrayBuffer();
	return { bytes: new Uint8Array(buf), width: canvas.width, height: canvas.height };
}

/** Uint8Array → base64 (chunked to avoid call-stack blowup on big pages). */
export function bytesToBase64(bytes: Uint8Array): string {
	let s = "";
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(s);
}
