import type { TextBox } from "./pdf";

/**
 * Figure pipeline: the LLM marks relevant pictures with FIGURE lines
 * carrying 0–1000 bounding boxes; we crop those regions from the slide
 * render and embed only the crops. Full slides are never embedded.
 */

export interface FigureRef {
	/** 0-based line index in the assembled markdown (for replacement). */
	lineIndex: number;
	slide: number;
	/** 0–1000, origin top-left. */
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	caption: string;
}

export interface PixelBox {
	px1: number;
	py1: number;
	px2: number;
	py2: number;
}


const MAX_FIGURES_PER_SLIDE = 5;
const MIN_BOX_UNITS = 40; // in 0–1000 units; filters logos/bullets
const QUAD_RE = /\[\s*(\d{1,4})\s*,\s*(\d{1,4})\s*,\s*(\d{1,4})\s*,\s*(\d{1,4})\s*\]/;
const FIGURE_HINT_RE = /figur|bbox|crop|\bfig\b/i;
// Primary heading is "## <title> (<N>)" (page number in trailing parens);
// the legacy "## Slide <N>" form is kept as a fallback.
const SLIDE_HEADING_RE = /^##\s+.+\((?:slide\s*)?(\d+)\)\s*$/i;
const SLIDE_HEADING_LEGACY_RE = /^##\s+Slide\s+(\d+)/i;

/** True when a line is a FIGURE directive (as opposed to prose). */
function isFigureLine(line: string): boolean {
	return FIGURE_HINT_RE.test(line) && QUAD_RE.test(line);
}

/** Extract FIGURE references from LLM markdown. Pure — safe to unit-test. */
export function parseFigureReferences(markdown: string): FigureRef[] {
	const refs: FigureRef[] = [];
	const lines = markdown.split("\n");
	let slide = -1;
	const perSlide = new Map<number, number>();
	lines.forEach((line, lineIndex) => {
		const hm = line.match(SLIDE_HEADING_RE) ?? line.match(SLIDE_HEADING_LEGACY_RE);
		if (hm) {
			slide = parseInt(hm[1], 10);
			return;
		}
		if (slide < 0) return;
		if (!FIGURE_HINT_RE.test(line)) return;
		const q = line.match(QUAD_RE);
		if (!q || q.index === undefined) return;
		const nums = q.slice(1, 5).map(Number);
		const cx1 = clamp(Math.min(nums[0], nums[2]), 0, 1000);
		const cx2 = clamp(Math.max(nums[0], nums[2]), 0, 1000);
		const cy1 = clamp(Math.min(nums[1], nums[3]), 0, 1000);
		const cy2 = clamp(Math.max(nums[1], nums[3]), 0, 1000);
		if (cx2 - cx1 < MIN_BOX_UNITS || cy2 - cy1 < MIN_BOX_UNITS) return;
		const count = perSlide.get(slide) ?? 0;
		if (count >= MAX_FIGURES_PER_SLIDE) return;
		perSlide.set(slide, count + 1);
		const after = line
			.slice(q.index + q[0].length)
			.trim()
			.replace(/^\|\s*/, "");
		refs.push({
			lineIndex,
			slide,
			x1: cx1,
			y1: cy1,
			x2: cx2,
			y2: cy2,
			caption: sanitizeCaption(after || `Slide ${slide} figure ${count + 1}`),
		});
	});
	return refs;
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}

function sanitizeCaption(c: string): string {
	return c
		.replace(/[[\]|]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
}

/** 0–1000 box → pixel box on a W×H render, with a small padding, clamped. */
export function boxToPixels(
	box: Pick<FigureRef, "x1" | "y1" | "x2" | "y2">,
	width: number,
	height: number,
	padFrac = 0.02,
): PixelBox {
	const padX = width * padFrac;
	const padY = height * padFrac;
	return {
		px1: Math.max(0, Math.floor((box.x1 / 1000) * width - padX)),
		py1: Math.max(0, Math.floor((box.y1 / 1000) * height - padY)),
		px2: Math.min(width, Math.ceil((box.x2 / 1000) * width + padX)),
		py2: Math.min(height, Math.ceil((box.y2 / 1000) * height + padY)),
	};
}

/** How much a crop may grow to swallow clipped text before we give up. */
const MAX_CROP_GROWTH = 3;

/**
 * Grow a crop box until every text run it touches is fully inside it, so no
 * line is sliced in half. Returns null when that would make the crop too
 * large — the caller then drops the figure entirely ("all of it or none").
 */
export function fitCropAroundText(
	box: PixelBox,
	textBoxes: TextBox[],
	width: number,
	height: number,
): PixelBox | null {
	const cur = { ...box };
	const area = (b: PixelBox) => Math.max(1, (b.px2 - b.px1) * (b.py2 - b.py1));
	const originalArea = area(box);
	// Clamp text runs to the page so sub-pixel overflow does not force a drop.
	const texts = textBoxes
		.map((t) => ({
			x1: Math.max(0, t.x1),
			y1: Math.max(0, t.y1),
			x2: Math.min(width, t.x2),
			y2: Math.min(height, t.y2),
		}))
		.filter((t) => t.x2 > t.x1 && t.y2 > t.y1);

	for (let pass = 0; pass < 8; pass++) {
		let changed = false;
		for (const t of texts) {
			const touches =
				t.x2 > cur.px1 && t.x1 < cur.px2 && t.y2 > cur.py1 && t.y1 < cur.py2;
			if (!touches) continue;
			const inside =
				t.x1 >= cur.px1 && t.x2 <= cur.px2 && t.y1 >= cur.py1 && t.y2 <= cur.py2;
			if (inside) continue;
			cur.px1 = Math.max(0, Math.min(cur.px1, Math.floor(t.x1)));
			cur.py1 = Math.max(0, Math.min(cur.py1, Math.floor(t.y1)));
			cur.px2 = Math.min(width, Math.max(cur.px2, Math.ceil(t.x2)));
			cur.py2 = Math.min(height, Math.max(cur.py2, Math.ceil(t.y2)));
			changed = true;
		}
		if (!changed) break;
	}

	if (area(cur) > originalArea * MAX_CROP_GROWTH) return null;

	// Anything still touching the box must be entirely inside it.
	for (const t of texts) {
		const touches =
			t.x2 > cur.px1 && t.x1 < cur.px2 && t.y2 > cur.py1 && t.y1 < cur.py2;
		if (!touches) continue;
		const inside =
			t.x1 >= cur.px1 - 0.5 &&
			t.x2 <= cur.px2 + 0.5 &&
			t.y1 >= cur.py1 - 0.5 &&
			t.y2 <= cur.py2 + 0.5;
		if (!inside) return null;
	}
	return cur;
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("could not decode page image"));
		img.src = url;
	});
}

/** Crop a PNG to the pixel box. Needs DOM (canvas) — runs in Obsidian. */
export async function cropPng(pngBytes: Uint8Array, box: PixelBox): Promise<Uint8Array> {
	const w = box.px2 - box.px1;
	const h = box.py2 - box.py1;
	if (w < 10 || h < 10) throw new Error("crop region too small");
	const url = URL.createObjectURL(
		new Blob([pngBytes as unknown as BlobPart], { type: "image/png" }),
	);
	try {
		const img = await loadImage(url);
		const canvas = createEl("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas 2D context unavailable");
		ctx.drawImage(img, box.px1, box.py1, w, h, 0, 0, w, h);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob((b) => resolve(b), "image/png"),
		);
		if (!blob) throw new Error("canvas.toBlob returned null");
		return new Uint8Array(await blob.arrayBuffer());
	} finally {
		URL.revokeObjectURL(url);
	}
}

/**
 * Replace FIGURE lines with their rendered replacement (embed + caption),
 * or delete them when the replacement is empty.
 * Pure — safe to unit-test.
 */
export function applyFigureEmbeds(
	markdown: string,
	embeds: Map<number, string>,
): string {
	if (embeds.size === 0) return markdown;
	const lines = markdown.split("\n");
	const out: string[] = [];
	lines.forEach((line, i) => {
		if (!embeds.has(i)) {
			out.push(line);
			return;
		}
		const replacement = (embeds.get(i) ?? "").trim();
		if (replacement) {
			out.push("");
			out.push(replacement);
			out.push("");
		}
	});
	return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Remove FIGURE lines (they carry one-batch-only bboxes, useless as context
 * for later batches). Pure — safe to unit-test.
 */
export function stripFigureLines(markdown: string): string {
	return markdown
		.split("\n")
		.filter((line) => !isFigureLine(line))
		.join("\n");
}
