import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

/**
 * Minimal interface for what BookshelfSettingTab needs from the plugin.
 * Extends Plugin so it satisfies PluginSettingTab's super(app, plugin) call.
 * Using an interface here instead of importing from ./main breaks the
 * circular dependency (settings.ts ↔ main.ts) and eliminates IDE false-positives.
 */
interface IBookshelfPlugin extends Plugin {
    settings: BookshelfSettings;
    saveSettings(): Promise<void>;
    refreshView(): void;
    debouncedRefresh(): void;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type Theme = "cozy" | "cybersigilism";

export interface BookshelfSettings {
    theme: Theme;
    folderPath: string;
    tag: string;
    animationsEnabled: boolean;
}

export const DEFAULT_SETTINGS: BookshelfSettings = {
    theme: "cozy",
    folderPath: "Books",
    tag: "book",
    animationsEnabled: true,
};

// ─── Settings Tab ─────────────────────────────────────────────────────────────

export class BookshelfSettingTab extends PluginSettingTab {
    plugin: IBookshelfPlugin;

    constructor(app: App, plugin: IBookshelfPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ── Header
        containerEl.createEl("h2", { text: "📚 Cinematic Bookshelf" });
        containerEl.createEl("p", {
            text: "Configure your animated bookshelf experience.",
            cls: "setting-item-description",
        });

        // ── Divider
        containerEl.createEl("hr");

        // ── Theme
        new Setting(containerEl)
            .setName("🎨 Theme")
            .setDesc(
                "Choose your bookshelf aesthetic. Cozy uses warm wood tones; Cybersigilism uses matte black with neon glow."
            )
            .addDropdown((drop) =>
                drop
                    .addOption("cozy", "🌲 Cozy — Warm & Wooden")
                    .addOption("cybersigilism", "🧿 Cybersigilism — Neon & Dark")
                    .setValue(this.plugin.settings.theme)
                    .onChange(async (value: string) => {
                        this.plugin.settings.theme = value as Theme;
                        await this.plugin.saveSettings();
                        this.plugin.refreshView();
                    })
            );

        // ── Folder Path
        new Setting(containerEl)
            .setName("📁 Books folder")
            .setDesc(
                "Path to the folder containing your book notes (relative to vault root). Example: Books or Reading/Library"
            )
            .addText((text) =>
                text
                    .setPlaceholder("Books")
                    .setValue(this.plugin.settings.folderPath)
                    .onChange(async (value: string) => {
                        this.plugin.settings.folderPath = value.trim();
                        await this.plugin.saveSettings();
                        this.plugin.debouncedRefresh();
                    })
            );

        // ── Tag
        new Setting(containerEl)
            .setName("🏷️ Book tag")
            .setDesc(
                "Tag used to identify book notes (without #). Notes with this tag anywhere in the vault will appear on the shelf."
            )
            .addText((text) =>
                text
                    .setPlaceholder("book")
                    .setValue(this.plugin.settings.tag)
                    .onChange(async (value: string) => {
                        // Strip leading # if user types it
                        this.plugin.settings.tag = value.trim().replace(/^#/, "");
                        await this.plugin.saveSettings();
                        this.plugin.debouncedRefresh();
                    })
            );

        // ── Animations Toggle
        new Setting(containerEl)
            .setName("✨ Enable animations")
            .setDesc(
                "Toggle staggered entrance animations and hover effects. Disable for accessibility or performance."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.animationsEnabled)
                    .onChange(async (value: boolean) => {
                        this.plugin.settings.animationsEnabled = value;
                        await this.plugin.saveSettings();
                        this.plugin.refreshView();
                    })
            );

        // ── Footer
        containerEl.createEl("hr");
        const footer = containerEl.createEl("p", {
            cls: "setting-item-description",
        });
        footer.innerHTML =
            "Add <code>title</code>, <code>author</code>, <code>status</code>, <code>rating</code>, <code>color</code>, and <code>progress</code> YAML frontmatter to your book notes for full shelf metadata.";
    }
}
