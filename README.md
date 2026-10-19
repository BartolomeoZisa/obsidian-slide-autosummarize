# Slide Autosummarize — Obsidian plugin

Auto-summarize a PDF slide deck into study-ready class notes:
concise per-slide notes in LaTeX, plus only the relevant figures —
picked by the LLM with bounding boxes, cropped and embedded.

## How it works

1. Right-click a PDF (or run **Summarize active PDF**) → plugin reads the binary from the vault.
2. `src/pdf.ts` extracts text per page with pdf.js and renders each page to PNG (best-effort; falls back to text-only).
3. `src/summarizer.ts` batches slides (default 3/call) and sends text + images to the configured LLM. Each batch also receives the **previously written notes** as context (`buildPriorNotesSection`), so terminology and notation stay consistent across the deck.
4. The model writes class notes plus `FIGURE [x1,y1,x2,y2] | caption` lines for relevant pictures only. `src/figures.ts` parses them, crops the regions from the slide renders, and embeds just the crops (`![[…-figN.png|caption]]`). Full slides are never embedded.
5. The note is written to `<outputFolder>/<pdf-name>.md` with frontmatter and per-slide sections.

## Modular LLM providers

One interface, one file per API — see `src/llm/`:

| File | Provider |
|---|---|
| `types.ts` | `LLMProvider` interface + shared fetch helpers |
| `prompt.ts` | shared system/batch prompts (LaTeX + per-slide rules) |
| `gemini.ts` | Google Gemini (Generative Language REST, no SDK) — **default, try first** |
| `openai-compatible.ts` | OpenAI + Ollama (local) + any `/v1/chat/completions` endpoint |
| `anthropic.ts` | Anthropic Messages API |
| `factory.ts` | **registry** — add your provider here to wire it into settings + pipeline |

To add a new API (e.g. Mistral, Cohere, local llama.cpp server):

1. Create `src/llm/my-provider.ts` implementing `LLMProvider` (`summarizeSlides`).
2. Register it in `src/llm/factory.ts` (`allProviders()` + `ProviderId`).
3. Add its key/model fields to `SummarizerSettings` and the settings tab. Done.

## Try it first with Gemini

1. Get a key at https://aistudio.google.com/apikey
2. Settings → Slide Autosummarize → provider **Google Gemini** → paste key, model `gemini-3.5-flash-lite` (default; the dropdown also offers `gemma-4-31b-it` and friends, plus Custom for any other id).
3. Open any PDF in the vault → `Ctrl/Cmd+P` → **Summarize active PDF**.

## Ollama (local)

1. `ollama pull qwen2.5vl` (or `llava`, `gemma3` — needs a vision model for slide images; otherwise disable *Send slide images*).
2. Settings → provider **Ollama (local)**, base URL `http://localhost:11434/v1`, model `qwen2.5vl`.
3. Run the same command. No API key needed.

## Develop

```bash
npm install
npm run dev      # watch-build to main.js
npm run build    # typecheck + production bundle
```

Copy `main.js`, `manifest.json`, `styles.css` into
`<vault>/.obsidian/plugins/slide-autosummarize/` and enable in
Settings → Community plugins.

## Notes

- Output keeps valid LaTeX (`$…$` inline, `$$…$$` display) so MathJax renders in Obsidian/Obsidian Publish.
- Figure embeds are cropped PNGs with the LLM's caption — delete any that aren't relevant, or turn off *Embed relevant figures* for text-only notes.
- Large decks: lower *Slides per LLM call* if the model truncates; raise *Render scale* for denser slides (sharper crops, more tokens).
