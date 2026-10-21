import { ItemView, Menu, normalizePath, type TFile } from "obsidian";
import { default as anime, type AnimeTimelineInstance } from "animejs";
import {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    BufferGeometry,
    BufferAttribute,
    PointsMaterial,
    Points,
    GridHelper,
    Mesh,
    AdditiveBlending,
} from "three";

import type CinematicBookshelfPlugin from "./main";
import { type Theme, type SortOrder, type FilterMode, type StatusDefinition } from "./settings";
import { parseColor, shiftLightness, hslToString, hashCode } from "./colour";
import {
    addDays,
    currentStreak,
    daysForBook,
    heatmapByWeek,
    levelFor,
    minutesInWeekEnding,
    streakEndingOn,
    todayKey,
} from "./log";

export const VIEW_TYPE_BOOKSHELF = "cinematic-bookshelf-view";

interface Book {
    file: TFile;
    title: string;
    author?: string;
    status?: string;
    rating?: number;
    color?: string;
    progress?: number;
    series?: string;
    position?: number;
    added: number;
}

interface ShelfRow {
    /** The series this row holds, or undefined for the ungrouped row. */
    series?: string;
    books: Book[];
}

const STATUS_FALLBACK = "#8b9dc3";

export class BookshelfView extends ItemView {
    // Three.js state
    private threeScene: Scene | null = null;
    private threeRenderer: WebGLRenderer | null = null;
    private threeCamera: PerspectiveCamera | null = null;
    private threeAnimFrame: number | null = null;

    // Anime.js timeline reference (for cleanup)
    private entranceTimeline: AnimeTimelineInstance | null = null;

    // ResizeObserver for three.js canvas
    private resizeObserver: ResizeObserver | null = null;

    // The log bar, shown when a book is opened
    private logBar: HTMLElement | null = null;

    // Search term, held outside the DOM so it survives a re-render
    private searchTerm = "";

    constructor(leaf: any, private plugin: CinematicBookshelfPlugin) {
        super(leaf);

        // Three.js state
        this.threeScene = null;
        this.threeRenderer = null;
        this.threeCamera = null;
        this.threeAnimFrame = null;

        // Anime.js timeline reference (for cleanup)
        this.entranceTimeline = null;

        // ResizeObserver for three.js canvas
        this.resizeObserver = null;
    }

    getViewType(): string {
        return VIEW_TYPE_BOOKSHELF;
    }

    getDisplayText(): string {
        return "Cinematic Bookshelf";
    }

    getIcon(): string {
        return "book-open";
    }

    async onOpen(): Promise<void> {
        await this.render();
    }

    async onClose(): Promise<void> {
        this.disposeThree();
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.entranceTimeline) {
            this.entranceTimeline.pause();
            this.entranceTimeline = null;
        }
    }

    // ─── Main Render ────────────────────────────────────────────────────────────

    async render(): Promise<void> {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("cinematic-bookshelf-container");

        const { theme, animationsEnabled } = this.plugin.settings;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const shouldAnimate = animationsEnabled && !reducedMotion;

        const shelf = container.createDiv({ cls: `cinematic-bookshelf ${theme}` });

        this.disposeThree();
        if (theme === "cybersigilism") {
            this.initThreeBackground(shelf);
        }

        const allBooks = this.getBooks();
        const visible = this.applyFilter(allBooks);
        const rows = this.buildRows(visible);

        this.renderToolbar(shelf, allBooks.length, visible.length);
        if (this.plugin.settings.trackingEnabled) {
            this.renderSummary(shelf, visible);
        }

        if (visible.length === 0) {
            this.renderEmptyState(shelf, allBooks.length);
            return;
        }

        const bookEls: HTMLElement[] = [];

        for (const row of rows) {
            if (row.series !== undefined) {
                const label = shelf.createDiv({ cls: "shelf-row-label" });
                label.createEl("span", { text: row.series });
            }

            const shelfRow = shelf.createDiv({ cls: "shelf-row" });
            const fragment = document.createDocumentFragment();

            row.books.forEach((book, index) => {
                const el = this.buildBookSpine(book, shouldAnimate, index);
                bookEls.push(el);
                fragment.appendChild(el);
            });
            shelfRow.appendChild(fragment);
            shelfRow.createDiv({ cls: "shelf-floor" });
        }

        if (shouldAnimate) {
            requestAnimationFrame(() => {
                this.triggerEntranceAnimation(bookEls);
            });
        } else {
            bookEls.forEach((el) => {
                el.style.opacity = "1";
                el.style.transform = "translateY(0) scale(1)";
            });
        }

        if (theme === "cybersigilism" && this.threeRenderer) {
            if (this.resizeObserver) this.resizeObserver.disconnect();
            this.resizeObserver = new ResizeObserver(() => {
                if (this.threeRenderer && this.threeCamera) {
                    const w = shelf.offsetWidth || 800;
                    const h = shelf.offsetHeight || 500;
                    this.threeRenderer.setSize(w, h);
                    this.threeCamera.aspect = w / h;
                    this.threeCamera.updateProjectionMatrix();
                }
            });
            this.resizeObserver.observe(shelf);
        }
    }

    // ─── Summary ───────────────────────────────────────────────────────────────

    /**
     * The strip above the shelf: the current streak, the minutes read this
     * week, how many books are finished, and a heatmap of the last 52 weeks.
     */
    private renderSummary(shelf: HTMLElement, books: Book[]): void {
        const log = this.plugin.log;
        const today = todayKey();
        const streak = currentStreak(log, today);
        const weekMinutes = minutesInWeekEnding(log, today);
        const finished = books.filter(
            (book) => book.status?.toLowerCase() === "completed",
        ).length;

        const summary = shelf.createDiv({ cls: "reading-summary" });
        const stats = summary.createDiv({ cls: "summary-stats" });

        const streakStat = stats.createDiv({ cls: "summary-stat" });
        streakStat.createEl("span", { cls: "stat-value", text: String(streak) });
        streakStat.createEl("span", { cls: "stat-label", text: "day streak" });

        const weekStat = stats.createDiv({ cls: "summary-stat" });
        weekStat.createEl("span", {
            cls: "stat-value",
            text: formatMinutes(weekMinutes),
        });
        weekStat.createEl("span", { cls: "stat-label", text: "this week" });

        const doneStat = stats.createDiv({ cls: "summary-stat" });
        doneStat.createEl("span", { cls: "stat-value", text: String(finished) });
        doneStat.createEl("span", { cls: "stat-label", text: "finished" });

        // ── The heatmap: one column per week, like a contribution graph.
        const weeks = heatmapByWeek(
            log,
            today,
            this.plugin.settings.heatmapWeeks,
        );
        const map = summary.createDiv({ cls: "summary-heatmap" });
        map.setAttribute("role", "img");
        map.setAttribute(
            "aria-label",
            `Reading activity over the last ${this.plugin.settings.heatmapWeeks} weeks, ${streak} day streak`,
        );
        for (const week of weeks) {
            const column = map.createDiv({ cls: "heat-week" });
            for (const cell of week.days) {
                const dot = column.createDiv({ cls: "heat-dot" });
                if (cell.level > 0) dot.addClass(`level-${cell.level}`);
                if (cell.date === today) dot.addClass("is-today");
                dot.setAttribute(
                    "title",
                    `${cell.date}: ${formatMinutes(cell.minutes)}`,
                );
            }
        }
    }

    // ─── The log bar ────────────────────────────────────────────────────────────

    /**
     * Show the log bar for a book.
     *
     * It appears over the shelf when a book is opened, so a session can be
     * recorded without leaving the note. The bar takes the date, the minutes
     * read, a status and a rating, and writes the status and rating into the
     * note's own frontmatter.
     */
    private showLogBar(book: Book): void {
        this.closeLogBar();

        const bar = this.containerEl.createDiv({ cls: "log-bar" });
        this.logBar = bar;

        const header = bar.createDiv({ cls: "log-bar-header" });
        header.createEl("span", { cls: "log-bar-title", text: book.title });

        const close = header.createEl("button", {
            cls: "log-bar-close",
            text: "Close",
            attr: { type: "button", "aria-label": "Close the log bar" },
        });
        close.addEventListener("click", () => this.closeLogBar());

        // ── The form
        const form = bar.createDiv({ cls: "log-bar-form" });

        // Date, defaulting to today but editable so a past session can be
        // logged.
        const dateField = form.createDiv({ cls: "log-field" });
        dateField.createEl("label", { text: "Date" });
        const dateInput = dateField.createEl("input", {
            cls: "log-input",
            attr: { type: "date", "aria-label": "Reading date" },
        });
        dateInput.value = todayKey();

        // Minutes.
        const minutesField = form.createDiv({ cls: "log-field" });
        minutesField.createEl("label", { text: "Minutes" });
        const minutesInput = minutesField.createEl("input", {
            cls: "log-input",
            attr: {
                type: "number",
                min: "0",
                max: "1440",
                step: "5",
                placeholder: "30",
                "aria-label": "Minutes read",
            },
        });

        // Status.
        const statusField = form.createDiv({ cls: "log-field" });
        statusField.createEl("label", { text: "Status" });
        const statusSelect = statusField.createEl("select", {
            cls: "log-input",
            attr: { "aria-label": "Status" },
        });
        statusSelect.createEl("option", { text: "Unchanged", value: "" });
        for (const status of this.plugin.settings.statuses) {
            statusSelect.createEl("option", {
                text: status.name,
                value: status.name,
            });
        }
        statusSelect.value = book.status ?? "";

        // Rating.
        const ratingField = form.createDiv({ cls: "log-field" });
        ratingField.createEl("label", { text: "Rating" });
        const ratingSelect = ratingField.createEl("select", {
            cls: "log-input",
            attr: { "aria-label": "Rating" },
        });
        ratingSelect.createEl("option", { text: "Unchanged", value: "" });
        for (let i = 1; i <= 5; i++) {
            ratingSelect.createEl("option", { text: String(i), value: String(i) });
        }
        ratingSelect.value = book.rating ? String(book.rating) : "";

        // ── Actions
        const actions = form.createDiv({ cls: "log-actions" });

        const logButton = actions.createEl("button", {
            cls: "mod-cta log-submit",
            text: "Log",
            attr: { type: "button" },
        });
        logButton.addEventListener("click", async () => {
            const minutes = Number(minutesInput.value);
            const date = dateInput.value;

            if (Number.isFinite(minutes) && minutes > 0 && date) {
                await this.plugin.logSession({
                    book: book.title,
                    path: book.file.path,
                    date,
                    minutes,
                });
                await this.writeBookState(book, {
                    status: statusSelect.value,
                    rating: ratingSelect.value,
                    date,
                });
                this.closeLogBar();
                this.render();
                return;
            }

            // Nothing to log, but the status or rating may still have changed.
            await this.writeBookState(book, {
                status: statusSelect.value,
                rating: ratingSelect.value,
            });
            this.closeLogBar();
            this.render();
        });

        const finishButton = actions.createEl("button", {
            cls: "log-finish",
            text: "Mark finished",
            attr: { type: "button" },
        });
        finishButton.addEventListener("click", async () => {
            const completed = this.plugin.settings.statuses.find(
                (status) => status.name.toLowerCase() === "completed",
            );
            await this.writeBookState(book, {
                status: completed?.name ?? "completed",
                rating: ratingSelect.value,
            });
            this.closeLogBar();
            this.render();
        });

        // A quick log without opening the note.
        const quick = bar.createDiv({ cls: "log-quick" });
        quick.createEl("span", { cls: "log-quick-label", text: "Quick log" });
        for (const minutes of [15, 30, 60]) {
            const button = quick.createEl("button", {
                cls: "log-quick-button",
                text: `${minutes}m`,
                attr: { type: "button" },
            });
            button.addEventListener("click", async () => {
                await this.plugin.logSession({
                    book: book.title,
                    path: book.file.path,
                    date: todayKey(),
                    minutes,
                });
                await this.writeBookState(book, {
                    status: statusSelect.value,
                    rating: ratingSelect.value,
                });
                this.closeLogBar();
                this.render();
            });
        }
    }

    private closeLogBar(): void {
        if (this.logBar) {
            this.logBar.remove();
            this.logBar = null;
        }
    }

    /**
     * Write the status, rating and last-read date into the note's
     * frontmatter, leaving the body untouched.
     */
    private async writeBookState(
        book: Book,
        state: { status: string; rating: string; date?: string },
    ): Promise<void> {
        const status = state.status;
        const rating = state.rating;

        await this.app.fileManager.processFrontMatter(book.file, (frontmatter) => {
            if (status) {
                frontmatter.status = status;
            }
            if (rating) {
                frontmatter.rating = Number(rating);
            }
            if (state.date) {
                frontmatter.lastRead = state.date;
            }
        });
    }

    // ─── Toolbar ────────────────────────────────────────────────────────────────

    private renderToolbar(
        shelf: HTMLElement,
        total: number,
        shown: number,
    ): void {
        const { filter, sortOrder } = this.plugin.settings;

        const header = shelf.createDiv({ cls: "bookshelf-header" });

        const titleGroup = header.createDiv({ cls: "header-titles" });
        titleGroup.createEl("h2", { text: "Cinematic Bookshelf" });
        titleGroup.createEl("span", {
            cls: "book-count",
            text:
                shown === total
                    ? `${total} volume${total === 1 ? "" : "s"}`
                    : `${shown} of ${total} volume${total === 1 ? "" : "s"}`,
        });

        const controls = header.createDiv({ cls: "header-controls" });

        // ── Search
        const searchWrap = controls.createDiv({ cls: "search-wrap" });
        // The magnifier is drawn in CSS, so no icon font or emoji is needed.
        searchWrap.createEl("span", { cls: "search-icon" });
        const search = searchWrap.createEl("input", {
            cls: "shelf-search",
            attr: {
                type: "search",
                placeholder: "Search titles and authors",
                "aria-label": "Search books",
            },
        });
        search.value = this.searchTerm;
        search.addEventListener("input", () => {
            this.searchTerm = search.value;
            this.render();
        });
        search.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                this.searchTerm = "";
                this.render();
            }
            e.stopPropagation();
        });

        // ── Filter chips
        const chips = controls.createDiv({ cls: "filter-chips" });
        const filters: { value: FilterMode; label: string }[] = [
            { value: "all", label: "All" },
            { value: "reading", label: "Reading" },
            { value: "completed", label: "Completed" },
            { value: "unrated", label: "Unrated" },
        ];
        for (const option of filters) {
            const chip = chips.createEl("button", {
                cls: "filter-chip",
                text: option.label,
                attr: { type: "button", "aria-pressed": String(filter === option.value) },
            });
            if (filter === option.value) chip.addClass("is-active");
            chip.addEventListener("click", () => {
                this.plugin.settings.filter = option.value;
                void this.plugin.saveSettings();
                this.render();
            });
        }

        // ── Sort
        const sortWrap = controls.createDiv({ cls: "sort-wrap" });
        sortWrap.createEl("span", { cls: "sort-label", text: "Sort" });
        const sort = sortWrap.createEl("select", {
            cls: "shelf-sort",
            attr: { "aria-label": "Sort books" },
        });
        const sorts: { value: SortOrder; label: string }[] = [
            { value: "title", label: "Title" },
            { value: "author", label: "Author" },
            { value: "rating", label: "Rating" },
            { value: "progress", label: "Progress" },
            { value: "added", label: "Date added" },
        ];
        for (const option of sorts) {
            sort.createEl("option", {
                text: option.label,
                value: option.value,
            });
        }
        sort.value = sortOrder;
        sort.addEventListener("change", () => {
            this.plugin.settings.sortOrder = sort.value as SortOrder;
            void this.plugin.saveSettings();
            this.render();
        });
    }

    // ─── Empty State ─────────────────────────────────────────────────────────────

    private renderEmptyState(shelf: HTMLElement, total: number): void {
        const empty = shelf.createDiv({ cls: "bookshelf-empty" });
        empty.createDiv({ cls: "empty-icon" }).appendChild(bookshelfGlyph());
        empty.createEl("h3", {
            text: total === 0 ? "Your shelf is empty" : "Nothing matches",
        });

        const { folderPath, tag } = this.plugin.settings;
        empty.createEl("p", {
            text:
                total === 0
                    ? `Create notes in your "${folderPath}" folder or tag them with #${tag} to populate your bookshelf.`
                    : `${total} book${total === 1 ? " is" : "s are"} on the shelf, but none match the current filter and search.`,
        });

        const hint = empty.createEl("code", { cls: "empty-hint" });
        hint.innerHTML = `---<br>title: "My Book"<br>author: "Author Name"<br>status: reading<br>progress: 45<br>series: "The Expanse"<br>position: 2<br>---`;
    }

    // ─── Book Data Pipeline ──────────────────────────────────────────────────────

    private getBooks(): Book[] {
        const { folderPath, tag } = this.plugin.settings;
        const { vault, metadataCache } = this.app;
        const normalizedFolder = normalizePath(folderPath);

        return vault
            .getMarkdownFiles()
            .filter((file) => {
                const fileFolderPath = normalizePath(file.path);
                // An empty folder setting means the folder rule does not apply,
                // and the tag alone decides.
                const inFolder =
                    normalizedFolder === ""
                        ? false
                        : fileFolderPath.startsWith(normalizedFolder + "/") ||
                          fileFolderPath === normalizedFolder;

                const cache = metadataCache.getFileCache(file);
                const normalizedFmTags = (cache?.frontmatter?.tags ?? []).map(
                    (t: string) => t.replace(/^#/, ""),
                );
                const hasInlineTag = (cache?.tags ?? []).some(
                    (t) => t.tag === `#${tag}` || t.tag === tag,
                );
                const hasFrontmatterTag = normalizedFmTags.includes(tag);

                if (tag === "") return inFolder;
                return inFolder || hasInlineTag || hasFrontmatterTag;
            })
            .map((file) => {
                const cache = metadataCache.getFileCache(file);
                const fm = cache?.frontmatter ?? {};
                const progress =
                    typeof fm.progress === "number"
                        ? Math.min(100, Math.max(0, fm.progress))
                        : undefined;

                return {
                    file,
                    title: fm.title || file.basename,
                    // Some notes carry `authors` rather than `author`, so
                    // both are accepted, with `author` taking priority.
                    author:
                        fm.author ??
                        (typeof fm.authors === "string"
                            ? fm.authors
                            : Array.isArray(fm.authors)
                              ? fm.authors.join(", ")
                              : undefined),
                    status: fm.status,
                    rating:
                        typeof fm.rating === "number"
                            ? Math.min(5, Math.max(1, fm.rating))
                            : undefined,
                    color: fm.color,
                    progress,
                    series: fm.series,
                    position:
                        typeof fm.position === "number" ? fm.position : undefined,
                    added: file.stat?.ctime ?? 0,
                };
            });
    }

    /** Apply the search term and the filter chip. */
    private applyFilter(books: Book[]): Book[] {
        const { filter } = this.plugin.settings;
        const term = this.searchTerm.trim().toLowerCase();

        let result = books;

        if (term !== "") {
            result = result.filter(
                (book) =>
                    book.title.toLowerCase().includes(term) ||
                    (book.author ?? "").toLowerCase().includes(term) ||
                    (book.series ?? "").toLowerCase().includes(term),
            );
        }

        switch (filter) {
            case "reading":
                result = result.filter((book) => book.status === "reading");
                break;
            case "completed":
                result = result.filter((book) => book.status === "completed");
                break;
            case "unrated":
                result = result.filter((book) => book.rating === undefined);
                break;
            case "all":
            default:
                break;
        }

        return this.sortBooks(result);
    }

    private sortBooks(books: Book[]): Book[] {
        const { sortOrder } = this.plugin.settings;
        const sorted = [...books];

        switch (sortOrder) {
            case "author":
                // A book with no author sorts after the ones that have one,
                // rather than ahead of them.
                sorted.sort((a, b) => {
                    if (!a.author && !b.author) return a.title.localeCompare(b.title);
                    if (!a.author) return 1;
                    if (!b.author) return -1;
                    return (
                        a.author.localeCompare(b.author) ||
                        a.title.localeCompare(b.title)
                    );
                });
                break;
            case "rating":
                sorted.sort(
                    (a, b) =>
                        (b.rating ?? 0) - (a.rating ?? 0) ||
                        a.title.localeCompare(b.title),
                );
                break;
            case "progress":
                sorted.sort(
                    (a, b) =>
                        (b.progress ?? -1) - (a.progress ?? -1) ||
                        a.title.localeCompare(b.title),
                );
                break;
            case "added":
                sorted.sort((a, b) => b.added - a.added);
                break;
            case "title":
            default:
                sorted.sort((a, b) => a.title.localeCompare(b.title));
                break;
        }

        return sorted;
    }

    /**
     * Group the books into rows. Books sharing a `series` get their own row
     * and are ordered by their `position`; everything else shares the first
     * row.
     */
    private buildRows(books: Book[]): ShelfRow[] {
        const { groupBySeries } = this.plugin.settings;
        if (!groupBySeries) {
            return [{ books }];
        }

        const series = new Map<string, Book[]>();
        const loose: Book[] = [];

        for (const book of books) {
            if (book.series) {
                const group = series.get(book.series) ?? [];
                group.push(book);
                series.set(book.series, group);
            } else {
                loose.push(book);
            }
        }

        const rows: ShelfRow[] = [];

        if (loose.length > 0) {
            rows.push({ books: loose });
        }

        for (const [name, group] of [...series.entries()].sort((a, b) =>
            a[0].localeCompare(b[0]),
        )) {
            rows.push({
                series: name,
                books: group.sort(
                    (a, b) =>
                        (a.position ?? Number.MAX_SAFE_INTEGER) -
                            (b.position ?? Number.MAX_SAFE_INTEGER) ||
                        a.title.localeCompare(b.title),
                ),
            });
        }

        return rows;
    }

    // ─── Book Spine Builder ───────────────────────────────────────────────────────

    private buildBookSpine(book: Book, animated: boolean, index: number): HTMLElement {
        const { theme } = this.plugin.settings;
        const spineColor = this.resolveColor(book, theme);
        const isReading = book.status === "reading";
        const isCompleted = book.status === "completed";

        const bookEl = document.createElement("div");
        bookEl.className = [
            "book",
            isReading ? "is-reading" : "",
            isCompleted ? "is-completed" : "",
        ]
            .filter(Boolean)
            .join(" ");
        bookEl.dataset.path = book.file.path;
        bookEl.dataset.index = String(index);

        bookEl.style.setProperty("--book-color", spineColor.base);
        bookEl.style.setProperty("--book-color-dark", spineColor.dark);
        bookEl.style.setProperty("--book-color-light", spineColor.light);
        bookEl.style.setProperty("--book-index", String(index));

        if (animated) {
            bookEl.style.opacity = "0";
            bookEl.style.transform = "translateY(22px)";
        }

        // The hash is taken as an absolute value so the height stays inside
        // the intended range regardless of the sign of the hash.
        const heightVariant = 160 + (hashCode(book.title) % 80);
        bookEl.style.height = `${heightVariant}px`;

        // The full title is always available, even when the spine is too
        // narrow to show it.
        const tooltip = [
            book.title,
            book.author ? `by ${book.author}` : null,
            book.status ? `· ${book.status}` : null,
            book.series
                ? `· ${book.series}${book.position ? ` #${book.position}` : ""}`
                : null,
        ]
            .filter(Boolean)
            .join(" ");
        bookEl.setAttribute("title", tooltip);

        if (book.progress !== undefined && book.progress > 0) {
            const strip = document.createElement("div");
            strip.className = "progress-strip";
            strip.style.setProperty("--progress", `${book.progress}%`);
            strip.setAttribute("role", "img");
            strip.setAttribute("aria-label", `${book.progress}% read`);
            bookEl.appendChild(strip);
        }

        // The heat dots: one per day this book was read, over the configured
        // window, shaded by how long each session was.
        if (this.plugin.settings.trackingEnabled) {
            const heatDays = daysForBook(this.plugin.log, book.title);
            if (heatDays.size > 0) {
                const column = bookEl.createDiv({ cls: "book-heat" });
                const today = todayKey();
                const window = this.plugin.settings.heatDays;
                for (let i = window - 1; i >= 0; i--) {
                    const date = addDays(today, -i);
                    const minutes = heatDays.get(date) ?? 0;
                    const dot = column.createDiv({ cls: "heat-dot" });
                    const level = levelFor(minutes);
                    if (level > 0) dot.addClass(`level-${level}`);
                    dot.setAttribute(
                        "title",
                        minutes > 0
                            ? `${date}: ${formatMinutes(minutes)}`
                            : date,
                    );
                }
            }

            // A marker when the book has been read on consecutive days.
            const streak = streakEndingOn(this.plugin.log, todayKey());
            if (streak >= 2) {
                const marker = bookEl.createDiv({ cls: "book-streak" });
                marker.setAttribute("aria-label", `${streak} day streak`);
                marker.textContent = String(streak);
            }
        }

        const spine = document.createElement("div");
        spine.className = "book-spine-content";

        const titleEl = document.createElement("div");
        titleEl.className = "book-title";
        titleEl.textContent = book.title;
        spine.appendChild(titleEl);

        if (book.author) {
            const authorEl = document.createElement("div");
            authorEl.className = "book-author";
            authorEl.textContent = book.author;
            spine.appendChild(authorEl);
        }

        if (book.rating !== undefined) {
            const ratingEl = document.createElement("div");
            ratingEl.className = "book-rating";
            ratingEl.setAttribute("role", "img");
            ratingEl.setAttribute(
                "aria-label",
                `Rated ${book.rating} out of ${book.rating}`,
            );
            for (let i = 1; i <= 5; i++) {
                const dot = document.createElement("span");
                dot.className = `rating-dot${i <= book.rating ? " filled" : ""}`;
                ratingEl.appendChild(dot);
            }
            spine.appendChild(ratingEl);
        }

        if (book.series && book.position) {
            const seriesEl = document.createElement("div");
            seriesEl.className = "book-series";
            seriesEl.textContent = `#${book.position}`;
            spine.appendChild(seriesEl);
        }

        bookEl.appendChild(spine);

        if (book.status) {
            const badge = document.createElement("div");
            badge.className = `status-badge status-${this.slugify(book.status)}`;
            badge.style.setProperty(
                "--status-color",
                this.statusColor(book.status),
            );
            badge.setAttribute("aria-label", `Status: ${book.status}`);
            bookEl.appendChild(badge);
        }

        bookEl.addEventListener("click", () => {
            this.openBook(book);
            this.showLogBar(book);
        });
        bookEl.setAttribute("tabindex", "0");
        bookEl.setAttribute("role", "button");
        bookEl.setAttribute("aria-label", `Open ${book.title}`);
        bookEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.openBook(book);
                this.showLogBar(book);
            }
        });

        // A right click gives the quick actions, so a session can be logged
        // without opening the note.
        bookEl.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            this.showBookMenu(e, book);
        });

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!reducedMotion) {
            bookEl.addEventListener("mouseenter", () => {
                if (theme === "cozy") {
                    anime({
                        targets: bookEl,
                        translateY: -10,
                        duration: 220,
                        easing: "easeOutQuad",
                    });
                } else {
                    anime({
                        targets: bookEl,
                        scale: 1.06,
                        duration: 200,
                        easing: "easeOutQuad",
                    });
                    bookEl.classList.add("hover-glow");
                }
            });
            bookEl.addEventListener("mouseleave", () => {
                anime({
                    targets: bookEl,
                    translateY: 0,
                    scale: 1,
                    duration: 220,
                    easing: "easeOutQuad",
                });
                bookEl.classList.remove("hover-glow");
            });
        }

        return bookEl;
    }

    /**
     * Open a note in a split leaf, so the shelf stays in view rather than
     * being replaced by the note.
     */
    private openBook(book: Book): void {
        const leaf = this.app.workspace.getLeaf("split");
        void leaf.openFile(book.file);
    }

    /**
     * The quick actions on a spine: log a session of a few common lengths,
     * mark the book finished, or open it.
     */
    private showBookMenu(e: MouseEvent, book: Book): void {
        const menu = new Menu();
        const today = todayKey();

        for (const minutes of [15, 30, 60]) {
            menu.addItem((item) =>
                item
                    .setTitle(`Log ${minutes} minutes`)
                    .setIcon("clock")
                    .onClick(async () => {
                        await this.plugin.logSession({
                            book: book.title,
                            path: book.file.path,
                            date: today,
                            minutes,
                        });
                        this.render();
                    }),
            );
        }

        menu.addSeparator();

        const completed = this.plugin.settings.statuses.find(
            (status) => status.name.toLowerCase() === "completed",
        );
        menu.addItem((item) =>
            item
                .setTitle("Mark finished")
                .setIcon("check")
                .onClick(async () => {
                    await this.writeBookState(book, {
                        status: completed?.name ?? "completed",
                        rating: "",
                    });
                    this.render();
                }),
        );

        menu.addItem((item) =>
            item
                .setTitle("Open note")
                .setIcon("book-open")
                .onClick(() => this.openBook(book)),
        );

        menu.showAtMouseEvent(e);
    }

    // ─── Status Helpers ─────────────────────────────────────────────────────────

    private statusColor(status: string): string {
        const list: StatusDefinition[] = this.plugin.settings.statuses;
        const match = list.find(
            (entry) => entry.name.toLowerCase() === status.toLowerCase(),
        );
        return match?.color ?? STATUS_FALLBACK;
    }

    private slugify(value: string): string {
        return value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    // ─── Entrance Animation ───────────────────────────────────────────────────────

    private triggerEntranceAnimation(bookEls: HTMLElement[]): void {
        if (this.entranceTimeline) {
            this.entranceTimeline.pause();
        }
        this.entranceTimeline = anime.timeline({ easing: "easeOutExpo" });
        this.entranceTimeline.add({
            targets: bookEls,
            translateY: [22, 0],
            opacity: [0, 1],
            duration: 650,
            delay: anime.stagger(48, { start: 60 }),
        });
    }

    // ─── Colour Utilities ──────────────────────────────────────────────────────────

    /**
     * The colour a spine is drawn in, along with the darker and lighter
     * variants the gradient uses. A colour given in the note is parsed so
     * that hex, `rgb()` and named colours all work; a note with no colour
     * gets a deterministic one from its title.
     */
    private resolveColor(
        book: Book,
        theme: Theme,
    ): { base: string; dark: string; light: string } {
        const generated = this.generateColor(book.title, theme);

        if (!book.color) {
            return {
                base: generated.base,
                dark: generated.dark,
                light: generated.light,
            };
        }

        const parsed = parseColor(book.color);
        if (!parsed) {
            return {
                base: generated.base,
                dark: generated.dark,
                light: generated.light,
            };
        }

        return {
            base: hslToString(parsed),
            dark: hslToString(shiftLightness(parsed, -18)),
            light: hslToString(shiftLightness(parsed, 15)),
        };
    }

    /** Deterministic colour from a string, tuned per theme */
    private generateColor(
        str: string,
        theme: Theme,
    ): { base: string; dark: string; light: string } {
        const hash = hashCode(str);
        let h: number;
        let s: number;
        let l: number;

        if (theme === "cozy") {
            h = 20 + (hash % 180);
            s = 45 + ((hash >> 4) % 25);
            l = 35 + ((hash >> 8) % 20);
        } else {
            h = hash % 360;
            s = 70 + ((hash >> 4) % 25);
            l = 40 + ((hash >> 8) % 20);
        }

        const base = { h, s, l };
        return {
            base: hslToString(base),
            dark: hslToString(shiftLightness(base, -18)),
            light: hslToString(shiftLightness(base, 15)),
        };
    }

    // ─── Three.js Background (Cybersigilism) ─────────────────────────────────────

    private initThreeBackground(container: HTMLElement): void {
        const w = container.offsetWidth || 800;
        const h = container.offsetHeight || 500;

        this.threeScene = new Scene();
        this.threeCamera = new PerspectiveCamera(60, w / h, 0.1, 1000);
        this.threeCamera.position.z = 5;

        this.threeRenderer = new WebGLRenderer({
            alpha: true,
            antialias: false,
            powerPreference: "low-power",
        });
        this.threeRenderer.setSize(w, h);
        this.threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.threeRenderer.setClearColor(0x000000, 0);

        const canvas = this.threeRenderer.domElement;
        canvas.classList.add("three-bg-canvas");
        container.prepend(canvas);

        const COUNT = 150;
        const positions = new Float32Array(COUNT * 3);
        const alphas = new Float32Array(COUNT);

        for (let i = 0; i < COUNT; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 14;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 10;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 5;
            alphas[i] = Math.random();
        }

        const particleGeo = new BufferGeometry();
        particleGeo.setAttribute("position", new BufferAttribute(positions, 3));

        const cyanMat = new PointsMaterial({
            color: 0x00ffff,
            size: 0.05,
            transparent: true,
            opacity: 0.35,
            blending: AdditiveBlending,
            depthWrite: false,
        });
        const violetMat = new PointsMaterial({
            color: 0xaa44ff,
            size: 0.04,
            transparent: true,
            opacity: 0.3,
            blending: AdditiveBlending,
            depthWrite: false,
        });

        const cyanParticles = new Points(particleGeo, cyanMat);
        const violetParticles = new Points(particleGeo.clone(), violetMat);
        violetParticles.rotation.y = Math.PI * 0.33;

        this.threeScene.add(cyanParticles);
        this.threeScene.add(violetParticles);

        const gridHelper = new GridHelper(24, 36, 0x3300aa, 0x1a0044);
        gridHelper.position.y = -3.5;
        gridHelper.rotation.x = Math.PI * 0.05;
        this.threeScene.add(gridHelper);

        let frame = 0;
        const animate = () => {
            this.threeAnimFrame = requestAnimationFrame(animate);
            frame++;

            cyanParticles.rotation.y += 0.0006;
            cyanParticles.rotation.x += 0.0002;
            violetParticles.rotation.y -= 0.0004;
            violetParticles.rotation.z += 0.0003;
            gridHelper.position.z = (gridHelper.position.z - 0.008) % 1.5;

            if (this.threeRenderer && this.threeScene && this.threeCamera) {
                this.threeRenderer.render(this.threeScene, this.threeCamera);
            }
        };
        animate();
    }

    /** Clean up Three.js resources and cancel animation loops */
    private disposeThree(): void {
        if (this.threeAnimFrame !== null) {
            cancelAnimationFrame(this.threeAnimFrame);
            this.threeAnimFrame = null;
        }

        if (this.threeScene) {
            this.threeScene.traverse((obj) => {
                if (obj instanceof Mesh || obj instanceof Points) {
                    obj.geometry.dispose();
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach((m) => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            });
            this.threeScene = null;
        }

        if (this.threeRenderer) {
            this.threeRenderer.dispose();
            this.threeRenderer.domElement.remove();
            this.threeRenderer = null;
        }

        this.threeCamera = null;
    }
}

/**
 * A readable duration: minutes under an hour, then hours and minutes.
 */
export function formatMinutes(minutes: number): string {
    const total = Math.max(0, Math.round(minutes));
    if (total < 60) return `${total}m`;
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * A small bookshelf drawn as an SVG, used for the empty state.
 *
 * Drawing it rather than using an emoji keeps the plugin free of image
 * dependencies and lets the glyph take the theme's own colour.
 */
function bookshelfGlyph(): SVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 48 40");
    svg.setAttribute("width", "48");
    svg.setAttribute("height", "40");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    // Four books of different heights, standing on a shelf.
    const book = (x: number, width: number, height: number) => {
        const rect = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "rect",
        );
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", String(36 - height));
        rect.setAttribute("width", String(width));
        rect.setAttribute("height", String(height));
        rect.setAttribute("rx", "1.5");
        svg.appendChild(rect);
    };

    book(6, 9, 22);
    book(17, 7, 28);
    book(26, 9, 18);
    book(37, 5, 24);

    // The shelf itself.
    const shelf = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
    );
    shelf.setAttribute("x1", "3");
    shelf.setAttribute("y1", "36");
    shelf.setAttribute("x2", "45");
    shelf.setAttribute("y2", "36");
    svg.appendChild(shelf);

    return svg;
}
