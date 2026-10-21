import { Notice, Plugin, TFile, normalizePath, type WorkspaceLeaf } from "obsidian";

import {
    BookshelfSettingTab,
    DEFAULT_SETTINGS,
    type BookshelfSettings,
} from "./settings";
import { BookshelfView, VIEW_TYPE_BOOKSHELF } from "./bookshelfView";
import {
    LOG_KEY,
    exportLog,
    readLog,
    recordSession,
    removeBook,
    todayKey,
    writeLog,
    type LogState,
    type ReadingSession,
} from "./log";

export default class CinematicBookshelfPlugin extends Plugin {
    settings: BookshelfSettings = DEFAULT_SETTINGS;
    private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

    /** The reading log, kept alongside the settings in the plugin's data. */
    log: LogState = { sessions: [] };

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
        const data = (await this.loadData()) ?? {};
        const stored = data as Partial<BookshelfSettings>;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);

        // The status list is merged rather than replaced, so a status added in
        // a later version still appears for users who already have settings.
        if (!Array.isArray(stored.statuses) || stored.statuses.length === 0) {
            this.settings.statuses = DEFAULT_SETTINGS.statuses;
        }

        // The reading log lives in the same file as the settings, so it is
        // read back out of the saved data here.
        this.log = readLog(data);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(writeLog({ ...this.settings }, this.log));
    }

    // ─── Reading log ──────────────────────────────────────────────────────────

    /** Record a reading session and save it. */
    async logSession(session: ReadingSession): Promise<void> {
        this.log = recordSession(this.log, session);
        await this.saveSettings();
    }

    /** Drop every session for a book, used when its note goes away. */
    async forgetBook(book: string): Promise<void> {
        this.log = removeBook(this.log, book);
        await this.saveSettings();
    }

    /** The key the log is stored under. */
    static get logKey(): string {
        return LOG_KEY;
    }

    /**
     * Write the reading log to a file in the vault, so another tool can
     * pick it up. The file is named with the date, so exports do not
     * overwrite one another.
     */
    async exportLog(): Promise<void> {
        const json = exportLog(this.log);
        const name = `reading-log-${todayKey()}.json`;
        // Written to the vault root, which always exists.
        const path = normalizePath(name);

        try {
            const existing = this.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, json);
            } else {
                await this.app.vault.create(path, json);
            }
            new Notice(`Reading log exported to ${path}`);
        } catch (error) {
            new Notice(
                `Could not export the reading log: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
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
