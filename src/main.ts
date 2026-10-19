import { Notice, Plugin, TFile } from "obsidian";
import {
	DEFAULT_SETTINGS,
	SummarizerSettings,
	summarizePdfFile,
} from "./summarizer";
import { SlideAutosummarizeSettingTab } from "./settings";

export default class SlideAutosummarizePlugin extends Plugin {
	settings: SummarizerSettings = { ...DEFAULT_SETTINGS };
	private running = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new SlideAutosummarizeSettingTab(this.app, this));

		this.addRibbonIcon("sparkles", "Summarize active PDF", () => {
			const f = this.activePdfFile();
			if (f) void this.runForFile(f);
			else new Notice("Open a PDF in the vault to summarize it.");
		});

		this.addCommand({
			id: "summarize-active-pdf",
			name: "Summarize active PDF",
			checkCallback: (checking) => {
				const f = this.activePdfFile();
				if (!f) return false;
				if (!checking) void this.runForFile(f);
				return true;
			},
		});

		this.addCommand({
			id: "summarize-pdf-picker",
			name: "Summarize a PDF… (all PDFs in vault)",
			callback: () => {
				const pdfs = this.app.vault
					.getFiles()
					.filter((f) => f.extension.toLowerCase() === "pdf");
				if (pdfs.length === 0) {
					new Notice("No PDFs found in the vault.");
					return;
				}
				// Simple picker: summarize the most recently modified one if many?
				// For now, summarize each sequentially after user confirms via Notice.
				// A proper FuzzySuggestModal would be nicer — kept minimal on purpose.
				if (pdfs.length === 1) {
					void this.runForFile(pdfs[0]);
					return;
				}
				new Notice(
					`${pdfs.length} PDFs found — right-click a PDF in the explorer and choose “Summarize PDF slides”.`,
					8000,
				);
			},
		});

		// Right-click on a PDF in explorer / link.
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFile && file.extension.toLowerCase() === "pdf") {
					menu.addItem((item) =>
						item
							.setTitle("Summarize PDF slides")
							.setIcon("sparkles")
							.onClick(() => void this.runForFile(file)),
					);
				}
			}),
		);

		// Optional auto-summarize for newly added PDFs.
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (
					this.settings.autoSummarizeOnCreate &&
					file instanceof TFile &&
					file.extension.toLowerCase() === "pdf"
				) {
					// small delay so the binary is fully flushed to disk
					setTimeout(() => void this.runForFile(file), 1500);
				}
			}),
		);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<SummarizerSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private activePdfFile(): TFile | null {
		const f = this.app.workspace.getActiveFile();
		return f && f.extension.toLowerCase() === "pdf" ? f : null;
	}

	/** Guarded entry: one run per file at a time, errors surfaced via Notice. */
	async runForFile(file: TFile): Promise<void> {
		if (this.running.has(file.path)) {
			new Notice(`Already summarizing ${file.basename}…`);
			return;
		}
		this.running.add(file.path);
		const notice = new Notice(`Summarizing ${file.basename}… (extracting slides)`, 0);
		try {
			const outPath = await summarizePdfFile(
				this.app.vault,
				file,
				this.settings,
				(p) => {
					notice.setMessage(`Summarizing ${file.basename}… ${p.label}`);
				},
			);
			notice.setMessage(`Done → ${outPath}`);
			setTimeout(() => notice.hide(), 5000);
			const out = this.app.vault.getAbstractFileByPath(outPath);
			if (out instanceof TFile) {
				await this.app.workspace.getLeaf(false).openFile(out);
			}
		} catch (e) {
			notice.hide();
			const msg = e instanceof Error ? e.message : String(e);
			console.error("slide-autosummarize failed:", e);
			new Notice(`Slide Autosummarize failed: ${msg}`, 12000);
		} finally {
			this.running.delete(file.path);
		}
	}
}
