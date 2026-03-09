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
import { type Theme } from "./settings";

export const VIEW_TYPE_BOOKSHELF = "cinematic-bookshelf-view";

interface Book {
    file: TFile;
    title: string;
    author?: string;
    status?: string;
    rating?: number;
    color?: string;
    progress?: number;
}

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

    constructor(leaf: any, private plugin: CinematicBookshelfPlugin) {
        super(leaf);
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
        const books = this.getBooks();

        if (books.length === 0) {
            this.renderEmptyState(shelf);
            return;
        }

        const header = shelf.createDiv({ cls: "bookshelf-header" });
        header.createEl("h2", { text: "📚 Cinematic Bookshelf" });
        header.createEl("span", {
            cls: "book-count",
            text: `${books.length} volume${books.length !== 1 ? "s" : ""}`,
        });

        this.disposeThree();
        if (theme === "cybersigilism") {
            this.initThreeBackground(shelf);
        }

        const shelfRow = shelf.createDiv({ cls: "shelf-row" });
        const fragment = document.createDocumentFragment();
        const bookEls: HTMLElement[] = [];

        books.forEach((book, index) => {
            const el = this.buildBookSpine(book, shouldAnimate, index);
            bookEls.push(el);
            fragment.appendChild(el);
        });
        shelfRow.appendChild(fragment);

        shelf.createDiv({ cls: "shelf-floor" });

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

    // ─── Empty State ─────────────────────────────────────────────────────────────

    private renderEmptyState(shelf: HTMLElement): void {
        const empty = shelf.createDiv({ cls: "bookshelf-empty" });
        empty.createEl("div", { cls: "empty-icon", text: "📚" });
        empty.createEl("h3", { text: "Your shelf is empty" });
        empty.createEl("p", {
            text: `Create notes in your "${this.plugin.settings.folderPath}" folder or tag them with #${this.plugin.settings.tag} to populate your bookshelf.`,
        });
        const hint = empty.createEl("code", { cls: "empty-hint" });
        hint.innerHTML = `---<br>title: "My Book"<br>author: "Author Name"<br>status: reading<br>progress: 45<br>---`;
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
                const inFolder =
                    fileFolderPath.startsWith(normalizedFolder + "/") ||
                    fileFolderPath === normalizedFolder;

                const cache = metadataCache.getFileCache(file);
                const normalizedFmTags = (cache?.frontmatter?.tags ?? []).map(
                    (t: string) => t.replace(/^#/, ""),
                );
                const hasInlineTag = (cache?.tags ?? []).some(
                    (t) => t.tag === `#${tag}` || t.tag === tag,
                );
                const hasFrontmatterTag = normalizedFmTags.includes(tag);

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
                };
            })
            .sort((a, b) => a.title.localeCompare(b.title));
    }

    // ─── Book Spine Builder ───────────────────────────────────────────────────────

    private buildBookSpine(book: Book, animated: boolean, index: number): HTMLElement {
        const { theme } = this.plugin.settings;
        const spineColor = book.color || this.generateColor(book.title, theme);
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

        bookEl.style.setProperty("--book-color", spineColor);
        bookEl.style.setProperty("--book-color-dark", this.shiftLightness(spineColor, -18));
        bookEl.style.setProperty("--book-color-light", this.shiftLightness(spineColor, 15));
        bookEl.style.setProperty("--book-index", String(index));

        if (animated) {
            bookEl.style.opacity = "0";
            bookEl.style.transform = "translateY(22px)";
        }

        const heightVariant = 160 + (this.hashCode(book.title) % 80);
        bookEl.style.height = `${heightVariant}px`;

        if (book.progress !== undefined && book.progress > 0) {
            const strip = document.createElement("div");
            strip.className = "progress-strip";
            strip.style.setProperty("--progress", `${book.progress}%`);
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
            for (let i = 1; i <= 5; i++) {
                const dot = document.createElement("span");
                dot.className = `rating-dot${i <= book.rating ? " filled" : ""}`;
                ratingEl.appendChild(dot);
            }
            spine.appendChild(ratingEl);
        }

        bookEl.appendChild(spine);

        if (book.status) {
            const badge = document.createElement("div");
            badge.className = `status-badge status-${book.status}`;
            badge.setAttribute("aria-label", `Status: ${book.status}`);
            bookEl.appendChild(badge);
        }

        bookEl.addEventListener("click", () => {
            this.app.workspace.getLeaf(false).openFile(book.file);
        });
        bookEl.setAttribute("tabindex", "0");
        bookEl.setAttribute("role", "button");
        bookEl.setAttribute("aria-label", `Open ${book.title}`);
        bookEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.app.workspace.getLeaf(false).openFile(book.file);
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

    // ─── Color Utilities ──────────────────────────────────────────────────────────

    /** Deterministic color from a string, tuned per theme */
    private generateColor(str: string, theme: Theme): string {
        const hash = this.hashCode(str);
        if (theme === "cozy") {
            const hue = 20 + (Math.abs(hash) % 180);
            const sat = 45 + (Math.abs(hash >> 4) % 25);
            const light = 35 + (Math.abs(hash >> 8) % 20);
            return `hsl(${hue}, ${sat}%, ${light}%)`;
        } else {
            const hue = Math.abs(hash) % 360;
            const sat = 70 + (Math.abs(hash >> 4) % 25);
            const light = 40 + (Math.abs(hash >> 8) % 20);
            return `hsl(${hue}, ${sat}%, ${light}%)`;
        }
    }

    /** Shift the lightness component of an hsl() color string */
    private shiftLightness(color: string, delta: number): string {
        return color.replace(
            /hsl\((\d+\.?\d*),\s*(\d+\.?\d*)%,\s*(\d+\.?\d*)%\)/,
            (_match, h, s, l) => {
                const newL = Math.min(100, Math.max(0, parseFloat(l) + delta));
                return `hsl(${h}, ${s}%, ${newL}%)`;
            },
        );
    }

    /** Simple deterministic hash from string */
    private hashCode(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = Math.imul(31, hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash;
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
