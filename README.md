# Slide Autosummarize

An Obsidian plugin that turns a PDF slide deck into **study-ready Markdown class notes**:
concise notes per slide, LaTeX equations, and only the *relevant* figures — picked by
the LLM with bounding boxes, cropped out of the slide, and embedded.

Works with **Google Gemini** (default), **OpenAI**, **Anthropic Claude**, and **Ollama**
(fully local). Providers are modular — see [Adding a provider](#adding-a-provider).

---

## Install

> Requires Obsidian **1.4.0** or later.

### Option A — Community plugins (once accepted)

1. Obsidian → **Settings → Community plugins → Browse**.
2. Search **Slide Autosummarize** → **Install** → **Enable**.

> Not in the directory yet (submission in progress). Until then, use one of the options below.
> You can follow the listing at <https://community.obsidian.md/plugins>.

### Option B — BRAT (easiest from GitHub, auto-updates)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs plugins straight from a
GitHub repo and keeps them updated.

1. Install **BRAT** from **Settings → Community plugins → Browse** and enable it.
2. Run `Ctrl/Cmd+P` → **BRAT: Add a beta plugin for testing**.
3. Paste: `https://github.com/BartolomeoZisa/obsidian-slide-autosummarize`
4. Click **Add Plugin** → enable **Slide Autosummarize** in
   **Settings → Community plugins**.

BRAT tracks the latest GitHub release, so future versions arrive without manual copying.

### Option C — Manual install from GitHub (no BRAT)

1. Open the [releases page](https://github.com/BartolomeoZisa/obsidian-slide-autosummarize/releases)
   and pick the latest release.
2. Download the three assets: `main.js`, `manifest.json`, `styles.css`
   (under **Assets**; do **not** download the "Source code" archives).
3. Create this folder in your vault:

   ```
   <your-vault>/.obsidian/plugins/slide-autosummarize/
   ```

   - **Windows:** `C:\Users\<you>\Documents\<vault>\.obsidian\plugins\slide-autosummarize\`
   - **macOS:** `~/Documents/<vault>/.obsidian/plugins/slide-autosummarize/`
   - **Linux:** `~/Documents/<vault>/.obsidian/plugins/slide-autosummarize/`

   The folder must be named exactly `slide-autosummarize` and the three files must sit
   **directly** inside it (not in a subfolder).
4. In Obsidian: **Settings → Community plugins** → turn off **Restricted mode** if needed →
   click the refresh icon next to **Installed plugins** → enable **Slide Autosummarize**.
5. If it does not appear, restart Obsidian.

Direct download links (once a release is published):

- [`main.js`](https://github.com/BartolomeoZisa/obsidian-slide-autosummarize/releases/latest/download/main.js)
- [`manifest.json`](https://github.com/BartolomeoZisa/obsidian-slide-autosummarize/releases/latest/download/manifest.json)
- [`styles.css`](https://github.com/BartolomeoZisa/obsidian-slide-autosummarize/releases/latest/download/styles.css)

Or from a terminal:

```bash
VAULT="$HOME/Documents/MyVault"   # <- your vault path
DEST="$VAULT/.obsidian/plugins/slide-autosummarize"
mkdir -p "$DEST"
BASE=https://github.com/BartolomeoZisa/obsidian-slide-autosummarize/releases/latest/download
for f in main.js manifest.json styles.css; do curl -fL "$BASE/$f" -o "$DEST/$f"; done
```

Windows PowerShell equivalent:

```powershell
$vault = "C:\Users\you\Documents\MyVault"
$dest  = Join-Path $vault ".obsidian\plugins\slide-autosummarize"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$base  = "https://github.com/BartolomeoZisa/obsidian-slide-autosummarize/releases/latest/download"
foreach ($f in "main.js","manifest.json","styles.css") {
  Invoke-WebRequest "$base/$f" -OutFile (Join-Path $dest $f)
}
```

### Option D — Build from source

```bash
git clone https://github.com/BartolomeoZisa/obsidian-slide-autosummarize.git
cd obsidian-slide-autosummarize
npm install
npm run build        # typecheck + production bundle -> main.js
```

Then copy `main.js`, `manifest.json`, `styles.css` into
`<vault>/.obsidian/plugins/slide-autosummarize/` and enable the plugin.

Development: `npm run dev` watch-builds `main.js` on save.

### Updating

- **BRAT:** updates automatically, or run `Ctrl/Cmd+P` → **BRAT: Check for updates to all beta plugins**.
- **Manual:** download the new `main.js` from the latest release and replace the old one
  (keep your `data.json` — that file holds your settings and API keys).
- **Community directory** (after acceptance): **Settings → Community plugins → Check for updates**.

---

## Set up a provider

Open **Settings → Slide Autosummarize** and pick a provider.

### Google Gemini (default)

1. Create a free API key at <https://aistudio.google.com/apikey>.
2. Provider: **Google Gemini** → paste the key.
3. Model: pick from the dropdown (`gemini-3.5-flash-lite` is the default) or choose
   **Custom…** and type any model id.

### OpenAI

1. Provider: **OpenAI** → paste your `sk-…` key.
2. Pick a model (`gpt-4o-mini`, `gpt-4o`, …) or **Custom…** for another id.

### Anthropic Claude

1. Provider: **Anthropic Claude** → paste your `sk-ant-…` key.
2. Pick a model or **Custom…**.

### Ollama (local, no API key)

1. Install [Ollama](https://ollama.com) and pull a **vision** model, e.g.:

   ```bash
   ollama pull qwen2.5vl
   ```

   Other options: `llava`, `gemma3`. Text-only models work too — turn off
   *Send slide images to the LLM* first.
2. Provider: **Ollama (local)**, base URL `http://localhost:11434/v1`, model `qwen2.5vl`.
3. No key needed.

### Any other OpenAI-compatible endpoint

Provider: **Custom OpenAI-compatible** → set the base URL
(`http://host:port/v1`), an optional API key, and the model id.
Works with vLLM, LM Studio, llama.cpp server, OpenRouter, Mistral, Together, …

---

## Use it

1. Put a PDF in your vault.
2. Open it, then either:
   - press `Ctrl/Cmd+P` → **Slide Autosummarize: Summarize active PDF**, or
   - right-click the PDF in the file explorer → **Summarize PDF slides**, or
   - click the ✨ icon in the left ribbon while a PDF is open.
3. Watch the progress notice. When it finishes, the note opens automatically.

Output goes to **`Summaries/<pdf-name>.md`** by default, with figures in
`Attachments/slides/<pdf-name>/`.

### What the note contains

```markdown
---
source-pdf: "[[lecture-03.pdf]]"
generated: 2026-10-17T09:12:44.000Z
provider: gemini
model: gemini-3.5-flash-lite
slides: 24
---

# lecture-03 — Slide Summary

> Auto-generated class notes from `[[lecture-03.pdf]]` (24 slides) with Google Gemini
> (`gemini-3.5-flash-lite`) on 2026-10-17.

## Slide 1

Notes for slide 1 …

## Slide 2

Notes, with math: the loss is $L(\theta) = -\sum_i \log p_\theta(y_i \mid x_i)$

$$
\nabla_\theta L = \mathbb{E}[\nabla_\theta \log p_\theta(y \mid x)]
$$

![[Attachments/slides/lecture-03/lecture-03-p02-fig1.png]]
*attention pattern across heads*
```

- Notes are written like class notes, not slide descriptions.
- Equations are real LaTeX (`$…$` inline, `$$…$$` display) and render in Reading view.
- **Only relevant figures are embedded**, cropped to the figure itself. Full slides
  are never embedded. Figures come from the LLM marking
  `FIGURE [x1,y1,x2,y2] | caption` (0–1000 coordinates) and the plugin cropping
  that region out of the page render.
- Later batches receive the notes written so far, so terminology, notation and
  definitions stay consistent across the whole deck.

---

## Settings reference

| Setting | What it does |
|---|---|
| **LLM provider** | Gemini / OpenAI / Anthropic / Ollama / Custom. |
| **Model** | Curated dropdown per provider, plus **Custom…** for any model id. |
| **Output folder** | Where the Markdown notes go (default `Summaries`). |
| **Image folder** | Where cropped figures (and optional full renders) are saved. |
| **Send slide images to the LLM** | Multimodal input. Required for figure detection. Turn off for text-only models / to save tokens. |
| **Embed relevant figures in the note** | Crop LLM-picked figures and embed them. Off = text-only note. |
| **Keep full slide renders** | Also save every rendered slide PNG (not embedded). Off by default. |
| **Slides per LLM call** | Batch size (default 3). Lower it if the model truncates output. |
| **Render scale** | Resolution of rendered slides (default 2.0). Higher = sharper crops, more tokens. |
| **Temperature** | On = omit the parameter and use the provider's own default. |
| **Max tokens** | Response cap per batch. |
| **Auto-retry on overload** | Retries per batch on 429/5xx/timeouts, exponential backoff honoring `Retry-After` (default 5, 0 = fail fast). |
| **Extra instructions** | Appended to every prompt, e.g. *“Write in Italian, undergraduate level, focus on derivations.”* |
| **Auto-summarize new PDFs** | Summarize every PDF added to the vault automatically. |

---

## Troubleshooting

**“Could not start the PDF engine”** — the pdf.js worker is bundled inside `main.js`
and loaded from a Blob URL, so no network access is needed. If you see this, check the
developer console (`Ctrl+Shift+I`) for the underlying error.

**HTTP 503 / “model is experiencing high demand”** — transient. The plugin retries
automatically with backoff; raise *Auto-retry on overload* if your deck is long.
Switch models if it persists.

**Empty or truncated notes** — lower *Slides per LLM call* (e.g. 1–2) and raise
*Max tokens*.

**No figures in the note** — figures require *Send slide images to the LLM* **and**
*Embed relevant figures*. Text-only models cannot detect figures.

**Wrong crop regions** — the model returned bad coordinates. Lower *Slides per LLM
call* (fewer slides per request = better spatial attention) or use a stronger
vision model.

**Wrong model id** — use **Custom…** and paste the exact id from the provider's docs.

---

## How it works

1. `src/pdf.ts` — extracts text per page with pdf.js and renders each page to PNG.
   If rendering fails, the plugin continues text-only.
2. `src/summarizer.ts` — batches slides, sends text + images + prior notes to the
   provider, then assembles and writes the Markdown note.
3. `src/figures.ts` — parses `FIGURE` lines, converts 0–1000 boxes to pixels,
   crops the PNGs, and swaps the directives for embeds.
4. `src/llm/` — one file per API behind a single `LLMProvider` interface.

### Adding a provider

1. Create `src/llm/my-provider.ts` implementing `LLMProvider`
   (`summarizeSlides`, `validateConfig`, `defaultModels`).
2. Register it in `src/llm/factory.ts` (`allProviders()` + `ProviderId`).
3. Add its settings fields to `SummarizerSettings` (`src/summarizer.ts`) and the
   settings tab (`src/settings.ts`).

## Privacy

The PDF is processed locally. Slide text and rendered page images are sent **only**
to the provider you configure (or to your own Ollama server). API keys are stored in
the plugin's `data.json` inside your vault — use a restricted key.

## License

GPL-3.0-or-later — see [LICENSE](LICENSE); copyright notice in [NOTICE](NOTICE).

This program is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software Foundation,
either version 3 of the License, or (at your option) any later version. If you
distribute a modified version, you must make the source available under the same
license.

Third-party components keep their own licenses: `pdfjs-dist` (Apache-2.0) is bundled
into `main.js`.
