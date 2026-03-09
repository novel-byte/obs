/**
 * Minimal type declarations for anime.js v3, which ships without them.
 * Only the surface this plugin uses is described.
 */
declare module "animejs" {
    interface AnimeInstance {
        pause(): AnimeInstance;
        play(): AnimeInstance;
    }

    interface AnimeTimelineInstance extends AnimeInstance {
        add(params: Record<string, unknown>): AnimeTimelineInstance;
    }

    interface AnimeParams {
        targets: unknown;
        [key: string]: unknown;
    }

    interface AnimeStatic {
        (params: AnimeParams): AnimeInstance;
        timeline(params?: Record<string, unknown>): AnimeTimelineInstance;
        stagger(
            value: number,
            options?: Record<string, unknown>,
        ): (target: unknown, index: number, length: number) => number;
    }

    const anime: AnimeStatic;
    export default anime;
    export { AnimeInstance, AnimeTimelineInstance, AnimeParams, AnimeStatic };
}
