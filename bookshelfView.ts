import { ItemView, normalizePath, type TFile } from "obsidian";
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
import { parseColor, shiftLightness, shiftSaturation, hslToString, hashCode } from "./colour";

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

    // ─── Toolbar ────────────────────────────────────────────────────────────────

    private renderToolbar(
        shelf: HTMLElement,
        total: number,
        shown: number,
    ): void {
        const { filter, sortOrder } = this.plugin.settings;

        const header = shelf.createDiv({ cls: "bookshelf-header" });

        const titleGroup = header.createDiv({ cls: "header-titles" });
        titleGroup.createEl("h2", { text: "📚 Cinematic Bookshelf" });
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
        searchWrap.createEl("span", { cls: "search-icon", text: "🔍" });
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
        empty.createEl("div", { cls: "empty-icon", text: "📚" });
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
                    author: fm.author,
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
        });
        bookEl.setAttribute("tabindex", "0");
        bookEl.setAttribute("role", "button");
        bookEl.setAttribute("aria-label", `Open ${book.title}`);
        bookEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.openBook(book);
            }
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
