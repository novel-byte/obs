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

export type SortOrder = "title" | "author" | "rating" | "progress" | "added";

export type FilterMode = "all" | "reading" | "completed" | "unrated";

export interface StatusDefinition {
    name: string;
    color: string;
}

export interface BookshelfSettings {
    theme: Theme;
    folderPath: string;
    tag: string;
    animationsEnabled: boolean;
    /** Sort order for the shelf. */
    sortOrder: SortOrder;
    /** Which books are shown. */
    filter: FilterMode;
    /** Show books that share a `series` frontmatter in their own row. */
    groupBySeries: boolean;
    /** The statuses recognised on a note, and the colour each one is drawn in. */
    statuses: StatusDefinition[];
    /** Use frosted glass surfaces rather than solid ones. */
    glassEnabled: boolean;
    /** Let the shelf follow the Obsidian theme's own colours. */
    followObsidianTheme: boolean;
}

export const DEFAULT_SETTINGS: BookshelfSettings = {
    theme: "cozy",
    folderPath: "Books",
    tag: "book",
    animationsEnabled: true,
    sortOrder: "title",
    filter: "all",
    groupBySeries: true,
    statuses: [
        { name: "reading", color: "#d9a441" },
        { name: "completed", color: "#6fcf7f" },
        { name: "paused", color: "#8b9dc3" },
        { name: "abandoned", color: "#c97f7f" },
    ],
    glassEnabled: true,
    followObsidianTheme: true,
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
                "Path to the folder containing your book notes, relative to the vault root. Example: Books or Reading/Library. Leave empty to use the tag alone."
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
                "Tag used to identify a book note (without #). Notes with this tag anywhere in the vault will appear on the shelf."
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

        // ── Sort order
        new Setting(containerEl)
            .setName("🔢 Sort by")
            .setDesc("The order books appear along the shelf.")
            .addDropdown((drop) =>
                drop
                    .addOption("title", "Title")
                    .addOption("author", "Author")
                    .addOption("rating", "Rating")
                    .addOption("progress", "Progress")
                    .addOption("added", "Date added")
                    .setValue(this.plugin.settings.sortOrder)
                    .onChange(async (value: string) => {
                        this.plugin.settings.sortOrder = value as SortOrder;
                        await this.plugin.saveSettings();
                        this.plugin.refreshView();
                    })
            );

        // ── Filter
        new Setting(containerEl)
            .setName("🔍 Show")
            .setDesc("Which books are on the shelf.")
            .addDropdown((drop) =>
                drop
                    .addOption("all", "All books")
                    .addOption("reading", "Reading")
                    .addOption("completed", "Completed")
                    .addOption("unrated", "Unrated")
                    .setValue(this.plugin.settings.filter)
                    .onChange(async (value: string) => {
                        this.plugin.settings.filter = value as FilterMode;
                        await this.plugin.saveSettings();
                        this.plugin.refreshView();
                    })
            );

        // ── Group by series
        new Setting(containerEl)
            .setName("📚 Group by series")
            .setDesc(
                "Give books sharing a `series` frontmatter their own row, in the order the `position` field gives."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.groupBySeries)
                    .onChange(async (value: boolean) => {
                        this.plugin.settings.groupBySeries = value;
                        await this.plugin.saveSettings();
                        this.plugin.refreshView();
                    })
            );

        // ── Glass
        new Setting(containerEl)
            .setName("🪟 Frosted glass")
            .setDesc(
                "Draw the spines as frosted panels over the background. Turn off for a solid shelf."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.glassEnabled)
                    .onChange(async (value: boolean) => {
                        this.plugin.settings.glassEnabled = value;
                        await this.plugin.saveSettings();
                        this.plugin.refreshView();
                    })
            );

        // ── Follow the Obsidian theme
        new Setting(containerEl)
            .setName("🎛️ Follow the Obsidian theme")
            .setDesc(
                "Take the base colours from Obsidian's own theme, so the shelf fits whichever theme you use."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.followObsidianTheme)
                    .onChange(async (value: boolean) => {
                        this.plugin.settings.followObsidianTheme = value;
                        await this.plugin.saveSettings();
                        this.plugin.refreshView();
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

        // ── Statuses
        containerEl.createEl("h3", { text: "Statuses" });
        containerEl.createEl("p", {
            text: "The statuses a note can carry, and the colour each is drawn in.",
            cls: "setting-item-description",
        });

        const statusList = containerEl.createDiv({ cls: "status-settings" });

        const renderStatuses = () => {
            statusList.empty();
            this.plugin.settings.statuses.forEach((status, index) => {
                const setting = new Setting(statusList)
                    .setName(status.name || "unnamed")
                    .addText((text) =>
                        text
                            .setPlaceholder("status")
                            .setValue(status.name)
                            .onChange(async (value: string) => {
                                this.plugin.settings.statuses[index]!.name =
                                    value.trim();
                                await this.plugin.saveSettings();
                                this.plugin.refreshView();
                            })
                    )
                    .addColorPicker((picker) =>
                        picker
                            .setValue(status.color)
                            .onChange(async (value: string) => {
                                this.plugin.settings.statuses[index]!.color = value;
                                await this.plugin.saveSettings();
                                this.plugin.refreshView();
                            })
                    )
                    .addExtraButton((extra) =>
                        extra
                            .setIcon("trash")
                            .setTooltip("Remove")
                            .onClick(async () => {
                                this.plugin.settings.statuses.splice(index, 1);
                                await this.plugin.saveSettings();
                                renderStatuses();
                                this.plugin.refreshView();
                            })
                    );
                setting.settingEl.addClass("status-setting");
            });

            new Setting(statusList).addButton((button) =>
                button
                    .setButtonText("Add a status")
                    .setCta()
                    .onClick(async () => {
                        this.plugin.settings.statuses.push({
                            name: "new status",
                            color: "#8b9dc3",
                        });
                        await this.plugin.saveSettings();
                        renderStatuses();
                        this.plugin.refreshView();
                    })
            );
        };

        renderStatuses();

        // ── Footer
        containerEl.createEl("hr");
        const footer = containerEl.createEl("p", {
            cls: "setting-item-description",
        });
        footer.innerHTML =
            "Add <code>title</code>, <code>author</code>, <code>status</code>, <code>rating</code>, <code>color</code>, <code>progress</code>, <code>series</code> and <code>position</code> YAML frontmatter to your book notes for full shelf metadata.";
    }
}
