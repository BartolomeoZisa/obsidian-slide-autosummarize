/**
 * PDF slide extraction.
 * - Text per page via pdf.js getTextContent (always attempted).
 * - Page render to PNG via pdf.js + <canvas> (best effort; falls back to
 *   text-only if rendering fails — e.g. worker unavailable).
 */

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

type PdfjsModule = typeof import("pdfjs-dist");

export interface ExtractedPage {
	pageNumber: number;
	text: string;
	/** Raw PNG bytes of the rendered page, if rendering succeeded. */
	imageBytes?: Uint8Array;
	/** Pixel dimensions of imageBytes (needed for bbox → pixel conversion). */
	imageWidth?: number;
	imageHeight?: number;
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
		try {
			const tc = await page.getTextContent();
			text = tc.items
				.map((it) => ("str" in it ? it.str : ""))
				.join(" ")
				.replace(/\s+/g, " ")
				.trim();
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
