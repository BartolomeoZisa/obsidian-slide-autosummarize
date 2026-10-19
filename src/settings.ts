import { App, PluginSettingTab, Setting } from "obsidian";
import type SlideAutosummarizePlugin from "./main";
import { SummarizerSettings } from "./summarizer";
import { getProvider } from "./llm/factory";

const CUSTOM_MODEL_OPTION = "__custom__";

export class SlideAutosummarizeSettingTab extends PluginSettingTab {
	plugin: SlideAutosummarizePlugin;

	constructor(app: App, plugin: SlideAutosummarizePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Model dropdown fed by the provider's curated defaults, plus a
	 * "Custom…" entry revealing a free-text field for any other model id.
	 * The single backing string keeps storage/validation untouched.
	 */
	private addModelPicker(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		providerId: string,
		get: () => string,
		set: (v: string) => void,
	): void {
		const models = getProvider(providerId).defaultModels;
		const current = get();
		const isCustom = !models.includes(current);
		if (models.length > 0) {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addDropdown((d) => {
					for (const m of models) d.addOption(m, m);
					d.addOption(CUSTOM_MODEL_OPTION, "Custom… (type below)");
					d.setValue(isCustom ? CUSTOM_MODEL_OPTION : current);
					d.onChange(async (v) => {
						if (v !== CUSTOM_MODEL_OPTION) set(v);
						else set("");
						await this.plugin.saveSettings();
						this.display();
					});
				});
		}
		if (models.length === 0 || isCustom || current === "") {
			new Setting(containerEl)
				.setName(models.length === 0 ? name : `${name} (custom)`)
				.setDesc(
					models.length === 0 ? desc : "Exact model id, e.g. gemini-3.5-flash-lite",
				)
				.addText((t) =>
					t
						.setPlaceholder(models[0] ?? "model-id")
						.setValue(current)
						.onChange(async (v) => {
							set(v.trim());
							await this.plugin.saveSettings();
						}),
				);
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s: SummarizerSettings = this.plugin.settings;
		const rerender = () => this.display();

		new Setting(containerEl)
			.setName("LLM provider")
			.setDesc("Modular backend. Gemini first; Ollama runs fully local. Add new providers as separate modules.")
			.addDropdown((d) =>
				d
					.addOption("gemini", "Google Gemini")
					.addOption("openai", "OpenAI")
					.addOption("anthropic", "Anthropic Claude")
					.addOption("ollama", "Ollama (local)")
					.addOption("custom", "Custom OpenAI-compatible")
					.setValue(s.provider)
					.onChange(async (v) => {
						s.provider = v as SummarizerSettings["provider"];
						await this.plugin.saveSettings();
						rerender();
					}),
			);

		new Setting(containerEl).setName("Provider credentials & models").setHeading();

		if (s.provider === "gemini") {
			new Setting(containerEl)
				.setName("Gemini API key")
				.setDesc("Create a key for the Gemini API.")
				.addText((t) =>
					t
						.setPlaceholder("Paste key…")
						.setValue(s.geminiApiKey)
						.onChange(async (v) => {
							s.geminiApiKey = v.trim();
							await this.plugin.saveSettings();
						}),
				);
			this.addModelPicker(
				containerEl,
				"Gemini model",
				"Curated defaults, or Custom for any other model id.",
				"gemini",
				() => s.geminiModel,
				(v) => {
					s.geminiModel = v;
				},
			);
		}
		if (s.provider === "openai") {
			new Setting(containerEl)
				.setName("OpenAI API key")
				.addText((t) =>
					t
						.setPlaceholder("Paste key…")
						.setValue(s.openaiApiKey)
						.onChange(async (v) => {
							s.openaiApiKey = v.trim();
							await this.plugin.saveSettings();
						}),
				);
			this.addModelPicker(
				containerEl,
				"OpenAI model",
				"Curated defaults, or Custom for any other model id.",
				"openai",
				() => s.openaiModel,
				(v) => {
					s.openaiModel = v;
				},
			);
		}
		if (s.provider === "anthropic") {
			new Setting(containerEl)
				.setName("Anthropic API key")
				.addText((t) =>
					t
						.setPlaceholder("Paste key…")
						.setValue(s.anthropicApiKey)
						.onChange(async (v) => {
							s.anthropicApiKey = v.trim();
							await this.plugin.saveSettings();
						}),
				);
			this.addModelPicker(
				containerEl,
				"Anthropic model",
				"Curated defaults, or Custom for any other model id.",
				"anthropic",
				() => s.anthropicModel,
				(v) => {
					s.anthropicModel = v;
				},
			);
		}
		if (s.provider === "ollama") {
			new Setting(containerEl)
				.setName("Ollama base URL")
				.setDesc("OpenAI-compatible endpoint. The default local server address works as-is.")
				.addText((t) =>
					t.setValue(s.ollamaBaseUrl).onChange(async (v) => {
						s.ollamaBaseUrl = v.trim();
						await this.plugin.saveSettings();
					}),
				);
			this.addModelPicker(
				containerEl,
				"Ollama model",
				"Vision-capable model recommended (qwen2.5vl, llava, gemma3), or Custom for any installed tag.",
				"ollama",
				() => s.ollamaModel,
				(v) => {
					s.ollamaModel = v;
				},
			);
		}
		if (s.provider === "custom") {
			new Setting(containerEl)
				.setName("Base URL")
				.setDesc("Any OpenAI-compatible /chat/completions endpoint")
				.addText((t) =>
					t.setValue(s.customBaseUrl).onChange(async (v) => {
						s.customBaseUrl = v.trim();
						await this.plugin.saveSettings();
					}),
				);
			new Setting(containerEl).setName("API key (if needed)").addText((t) =>
				t.setValue(s.customApiKey).onChange(async (v) => {
					s.customApiKey = v.trim();
					await this.plugin.saveSettings();
				}),
			);
			this.addModelPicker(
				containerEl,
				"Model",
				"Exact model id served by the endpoint.",
				"custom",
				() => s.customModel,
				(v) => {
					s.customModel = v;
				},
			);
		}

		new Setting(containerEl).setName("Pipeline").setHeading();

		new Setting(containerEl)
			.setName("Output folder")
			.setDesc("Markdown notes are written here, one per PDF.")
			.addText((t) =>
				t.setValue(s.outputFolder).onChange(async (v) => {
					s.outputFolder = v.trim() || "Summaries";
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Image folder")
			.setDesc("Rendered slide PNGs live in <folder>/<pdf-name>/ and get embedded in the note.")
			.addText((t) =>
				t.setValue(s.imageFolder).onChange(async (v) => {
					s.imageFolder = v.trim() || "Attachments/slides";
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Send slide images to the LLM")
			.setDesc("Multimodal input. Required for figure detection (bounding boxes). Disable for text-only models or to save tokens.")
			.addToggle((t) =>
				t.setValue(s.includeImages).onChange(async (v) => {
					s.includeImages = v;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Embed relevant figures in the note")
			.setDesc("Crops the LLM-picked figures (diagrams, charts, photos) via bounding boxes and embeds only those — never full slides.")
			.addToggle((t) =>
				t.setValue(s.embedImagesInNote).onChange(async (v) => {
					s.embedImagesInNote = v;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Keep full slide renders")
			.setDesc("Also save every rendered slide PNG to disk for reference (not embedded in the note).")
			.addToggle((t) =>
				t.setValue(s.saveFullPages).onChange(async (v) => {
					s.saveFullPages = v;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Slides per LLM call")
			.setDesc("Batch size. 2–4 keeps context tight; larger saves calls but risks truncation.")
			.addSlider((sl) =>
				sl
					.setLimits(1, 10, 1)
					.setValue(s.pagesPerBatch)
					.onChange(async (v) => {
						s.pagesPerBatch = v;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Render scale")
			.setDesc("Higher = sharper images for the LLM, more tokens. 2.0 ≈ good default.")
			.addSlider((sl) =>
				sl
					.setLimits(1, 4, 0.5)
					.setValue(s.renderScale)
					.onChange(async (v) => {
						s.renderScale = v;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Temperature")
			.setDesc("On = omit temperature from API calls (each provider uses its own default). Off = send the slider value.")
			.addToggle((t) =>
				t.setValue(s.useDefaultTemperature).onChange(async (v) => {
					s.useDefaultTemperature = v;
					await this.plugin.saveSettings();
					rerender();
				}),
			);
		if (!s.useDefaultTemperature) {
			new Setting(containerEl).setName("Custom temperature").addSlider((sl) =>
				sl
					.setLimits(0, 2, 0.1)
					.setValue(s.temperature)
					.onChange(async (v) => {
						s.temperature = v;
						await this.plugin.saveSettings();
					}),
			);
		}
		new Setting(containerEl)
			.setName("Auto-retry on overload")
			.setDesc("Retries each batch on transient errors (429, 5xx, timeouts) with exponential backoff, respecting any delay the server asks for. 0 = fail immediately.")
			.addSlider((sl) =>
				sl
					.setLimits(0, 10, 1)
					.setValue(s.maxRetries)
					.onChange(async (v) => {
						s.maxRetries = v;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Max tokens")
			.addText((t) =>
				t.setValue(String(s.maxTokens)).onChange(async (v) => {
					const n = parseInt(v, 10);
					if (Number.isFinite(n) && n > 0) {
						s.maxTokens = n;
						await this.plugin.saveSettings();
					}
				}),
			);
		new Setting(containerEl)
			.setName("Extra instructions")
			.setDesc("Appended to every summarization prompt (language, depth, focus…).")
			.addTextArea((t) =>
				t
					.setPlaceholder("Language, level, and focus instructions.")
					.setValue(s.customInstructions)
					.onChange(async (v) => {
						s.customInstructions = v;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Auto-summarize new PDF files")
			.setDesc("Watch the vault: every newly created .pdf gets summarized automatically.")
			.addToggle((t) =>
				t.setValue(s.autoSummarizeOnCreate).onChange(async (v) => {
					s.autoSummarizeOnCreate = v;
					await this.plugin.saveSettings();
				}),
			);
	}
}
