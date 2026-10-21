/**
 * Default system + per-batch prompts.
 * Notes style: concise class notes per slide. Figures: the model marks
 * relevant pictures with 0–1000 bounding boxes (FIGURE lines), which the
 * plugin crops from the slide render and embeds — nothing else is embedded.
 */

export const DEFAULT_SYSTEM_PROMPT = `You are a student taking excellent class notes in Obsidian-flavoured Markdown.`;

export function buildBatchPrompt(
	startPage: number,
	endPage: number,
	customInstructions = "",
): string {
	return `Take class notes for PDF slides (pages ${startPage}–${endPage}). For EACH slide output exactly:

## Slide <N>
<concise notes: the substance a student must remember — definitions, results, derivations, key formulas. Short bullets or tight paragraphs. Formulas in LaTeX: inline $...$, display $$...$$ on their own lines. Skip filler; if a slide is only a title, agenda or section divider, say so in one line. Where it genuinely helps understanding, add a short concrete example — a mini worked example, one numerical case, or a quick analogy — clearly introduced as an example. Keep it brief and skip it when the slide already contains one or when it would only restate the slide.>

FIGURES (only for slides with pictures worth keeping in notes):
For every RELEVANT figure — a diagram, chart, plot, photo, table or illustration that the notes would be worse without — output ONE line directly under the notes:
FIGURE [x1, y1, x2, y2] | short caption describing the figure

Rules for FIGURE lines:
- Coordinates are integers 0–1000 relative to the slide image, origin top-left. The box must tightly enclose the figure.
- The box must include ALL text that belongs to the figure: labels, axis ticks and numbers, legend entries, in-figure titles and the figure caption. Never cut through a line of text.
- If the figure cannot be enclosed without clipping its text (or would have to swallow unrelated slide text), omit it entirely — no FIGURE line. All of it or none of it.
- Only real content figures. NEVER box plain text, bullet lists, titles, logos, page numbers or decorative backgrounds.
- Most text-only slides have NO figures — then output no FIGURE line at all.
- At most 5 FIGURE lines per slide.

General rules:
- Cover every slide in the range, in order.
- Preserve technical terms, symbols, theorem/definition names exactly.
- LaTeX must be valid (never use Unicode math symbols in place of LaTeX commands).
- Output ONLY the ## Slide sections (notes + FIGURE lines), no preamble, no postamble.
- Do NOT invent content that is not on the slides; if a slide image is blurry, say so briefly and use the extracted text.
${customInstructions ? `\nAdditional instructions from the user:\n${customInstructions}\n` : ""}`.trim();
}

export function buildTextPartForSlide(pageNumber: number, text: string): string {
	const trimmed = (text || "").trim().slice(0, 6000);
	return trimmed
		? `--- SLIDE / PAGE ${pageNumber} (extracted text) ---\n${trimmed}`
		: `--- SLIDE / PAGE ${pageNumber} (no extractable text; rely on the image) ---`;
}

import { stripFigureLines } from "../figures";

/**
 * Context block of previously written notes, so later batches match
 * terminology, notation and style. FIGURE lines are stripped (their bboxes
 * belong to one batch only) and the text is budget-capped head+tail.
 */
export function buildPriorNotesSection(
	priorMarkdown: string,
	budgetChars = 20000,
): string {
	const cleaned = stripFigureLines(priorMarkdown).trim();
	if (!cleaned) return "";
	let notes = cleaned;
	if (notes.length > budgetChars) {
		const headLen = Math.floor(budgetChars * 0.6);
		const tailLen = budgetChars - headLen;
		notes =
			notes.slice(0, headLen) +
			"\n\n[…middle trimmed for length…]\n\n" +
			notes.slice(-tailLen);
	}
	return [
		"--- NOTES WRITTEN SO FAR (earlier slides, for consistency) ---",
		notes,
		"--- END OF PREVIOUS NOTES ---",
		"Match their terminology, symbols and notation. Continue, don't repeat: do not re-explain concepts already covered, do not re-emit FIGURE lines for earlier slides.",
	].join("\n");
}
