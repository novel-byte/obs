/**
 * Colour helpers for the bookshelf.
 *
 * Spines need a base colour plus a lighter and a darker variant so the
 * gradient across the spine reads as a rounded volume. Deriving those from
 * the raw string only works for `hsl()`, so colours are parsed into HSL
 * first and the variants are computed from that.
 */

export interface Hsl {
    h: number;
    s: number;
    l: number;
}

export function hslToString({ h, s, l }: Hsl): string {
    return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

/** Parse a hex colour into HSL. Returns null when the string is not hex. */
export function hexToHsl(hex: string): Hsl | null {
    const cleaned = hex.trim().replace(/^#/, "");
    if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(cleaned)) return null;

    const full =
        cleaned.length === 3
            ? cleaned
                  .split("")
                  .map((c) => c + c)
                  .join("")
            : cleaned;

    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const l = (max + min) / 2;

    let h = 0;
    let s = 0;

    if (delta !== 0) {
        s = delta / (1 - Math.abs(2 * l - 1));
        if (max === r) {
            h = 60 * (((g - b) / delta) % 6);
        } else if (max === g) {
            h = 60 * ((b - r) / delta + 2);
        } else {
            h = 60 * ((r - g) / delta + 4);
        }
    }

    if (h < 0) h += 360;

    return { h, s: s * 100, l: l * 100 };
}

/** Parse an `rgb()` or `rgba()` colour into HSL. */
export function rgbToHsl(value: string): Hsl | null {
    const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value);
    if (!match) return null;

    const r = Number(match[1]) / 255;
    const g = Number(match[2]) / 255;
    const b = Number(match[3]) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const l = (max + min) / 2;

    let h = 0;
    let s = 0;

    if (delta !== 0) {
        s = delta / (1 - Math.abs(2 * l - 1));
        if (max === r) {
            h = 60 * (((g - b) / delta) % 6);
        } else if (max === g) {
            h = 60 * ((b - r) / delta + 2);
        } else {
            h = 60 * ((r - g) / delta + 4);
        }
    }

    if (h < 0) h += 360;

    return { h, s: s * 100, l: l * 100 };
}

/**
 * Parse any colour the browser understands into HSL.
 *
 * Falls back to the browser's own parser for named colours and any modern
 * syntax, and returns null when the colour cannot be understood.
 */
export function parseColor(value: string): Hsl | null {
    const trimmed = value.trim();
    if (trimmed === "") return null;

    if (trimmed.startsWith("#")) return hexToHsl(trimmed);
    if (/^rgba?\(/i.test(trimmed)) return rgbToHsl(trimmed);

    if (/^hsla?\(/i.test(trimmed)) {
        const match = /hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i.exec(
            trimmed,
        );
        if (!match) return null;
        return {
            h: Number(match[1]),
            s: Number(match[2]),
            l: Number(match[3]),
        };
    }

    // Named colours and anything else the browser understands: let it
    // resolve the value and read the result back.
    if (typeof document === "undefined") return null;

    const probe = document.createElement("span");
    probe.style.color = trimmed;
    if (probe.style.color === "") return null;
    document.body.appendChild(probe);
    const computed = window.getComputedStyle(probe).color;
    probe.remove();

    return rgbToHsl(computed);
}

/** Shift the lightness of a colour, keeping it in range. */
export function shiftLightness(color: Hsl, delta: number): Hsl {
    return { ...color, l: Math.min(100, Math.max(0, color.l + delta)) };
}

/** Shift the saturation of a colour, keeping it in range. */
export function shiftSaturation(color: Hsl, delta: number): Hsl {
    return { ...color, s: Math.min(100, Math.max(0, color.s + delta)) };
}

/**
 * A stable hash of a string, always positive.
 *
 * The sign matters: a negative remainder would place a spine outside the
 * intended height range.
 */
export function hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = Math.imul(31, hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}
