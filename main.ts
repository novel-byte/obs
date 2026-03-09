import { Plugin, type WorkspaceLeaf } from "obsidian";

import {
    BookshelfSettingTab,
    DEFAULT_SETTINGS,
    type BookshelfSettings,
} from "./settings";
import { BookshelfView, VIEW_TYPE_BOOKSHELF } from "./bookshelfView";

export default class CinematicBookshelfPlugin extends Plugin {
    settings: BookshelfSettings = DEFAULT_SETTINGS;
    private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

    async onload(): Promise<void> {
        await this.loadSettings();

        this.registerView(
            VIEW_TYPE_BOOKSHELF,
            (leaf: WorkspaceLeaf) => new BookshelfView(leaf, this),
        );

        this.addRibbonIcon("book-open", "Cinematic Bookshelf", () => {
            this.activateView();
        });

        this.addCommand({
            id: "open-cinematic-bookshelf",
            name: "Open Cinematic Bookshelf",
            callback: () => this.activateView(),
        });

        this.addSettingTab(new BookshelfSettingTab(this.app, this));

        this.registerEvent(
            this.app.metadataCache.on("changed", () => this.debouncedRefresh()),
        );
        this.registerEvent(
            this.app.vault.on("create", () => this.debouncedRefresh()),
        );
        this.registerEvent(
            this.app.vault.on("delete", () => this.debouncedRefresh()),
        );
        this.registerEvent(
            this.app.vault.on("rename", () => this.debouncedRefresh()),
        );

        if (this.app.workspace.layoutReady) {
            this.activateView();
        } else {
            this.app.workspace.onLayoutReady(() => this.activateView());
        }
    }

    onunload(): void {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_BOOKSHELF);
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    // ─── View management ──────────────────────────────────────────────────────

    async activateView(): Promise<void> {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(VIEW_TYPE_BOOKSHELF);

        if (existing.length > 0) {
            workspace.revealLeaf(existing[0]);
            return;
        }

        const leaf = workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_BOOKSHELF, active: true });
            workspace.revealLeaf(leaf);
        }
    }

    /** Re-render all open bookshelf views immediately */
    refreshView(): void {
        this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOKSHELF).forEach((leaf) => {
            if (leaf.view instanceof BookshelfView) {
                leaf.view.render();
            }
        });
    }

    /** Re-render with a 500ms debounce — used for vault events */
    debouncedRefresh(): void {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            this.refreshView();
            this._debounceTimer = null;
        }, 500);
    }
}
