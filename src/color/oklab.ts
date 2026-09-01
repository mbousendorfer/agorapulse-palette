/**
 * OKLab / OKLCh <-> sRGB, plus WCAG contrast.
 *
 * Hand-rolled on purpose: this is the hot path. A palette re-solve runs ~3000
 * gamut tests, and every one of them goes through oklchToLinear. Allocating an
 * object per colour (as culori/colorjs.io do) is the wrong shape here.
 *
 * `culori` is a devDependency and is used only as a test oracle — see
 * __tests__/oracle.test.ts, which asserts agreement to 1e-7 on L and C, and a
 * byte-exact hex round-trip. (This said 1e-9 and pointed at a file that did not
 * exist; the measured worst case is 3.7e-8 — still ~100,000× below one 8-bit step.)
 *
 * Matrices are Ottosson's, verbatim. L is 0..1 (OKLab L, NOT CIE L*), C is
 * unbounded but practically 0..0.4 in sRGB, H is degrees 0..360.
 */

// linear sRGB -> LMS
const M1 = [
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
] as const;

// LMS' -> OKLab
const M2 = [
    [0.2104542553, 0.793617785, -0.0040720468],
    [1.9779984951, -2.428592205, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.808675766],
] as const;

// OKLab -> LMS'
const M2_INV = [
    [1.0, 0.3963377774, 0.2158037573],
    [1.0, -0.1055613458, -0.0638541728],
    [1.0, -0.0894841775, -1.291485548],
] as const;

// LMS -> linear sRGB
const M1_INV = [
    [4.0767416621, -3.3077115913, 0.2309699292],
    [-1.2684380046, 2.6097574011, -0.3413193965],
    [-0.0041960863, -0.7034186147, 1.707614701],
] as const;

export interface Oklch {
    L: number;
    C: number;
    H: number;
}

/** sRGB channel (0..1) -> linear. */
export function srgbToLinear(v: number): number {
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Linear channel -> sRGB (0..1). */
export function linearToSrgb(v: number): number {
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/**
 * OKLCh -> linear sRGB. Channels may fall outside 0..1 — that is exactly the
 * signal `inGamut` reads, so this must NOT clamp.
 */
export function oklchToLinear(L: number, C: number, H: number): [number, number, number] {
    const h = (H * Math.PI) / 180;
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);

    const l_ = M2_INV[0][0] * L + M2_INV[0][1] * a + M2_INV[0][2] * b;
    const m_ = M2_INV[1][0] * L + M2_INV[1][1] * a + M2_INV[1][2] * b;
    const s_ = M2_INV[2][0] * L + M2_INV[2][1] * a + M2_INV[2][2] * b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    return [
        M1_INV[0][0] * l + M1_INV[0][1] * m + M1_INV[0][2] * s,
        M1_INV[1][0] * l + M1_INV[1][1] * m + M1_INV[1][2] * s,
        M1_INV[2][0] * l + M1_INV[2][1] * m + M1_INV[2][2] * s,
    ];
}

/**
 * Is this OKLCh colour representable in sRGB?
 *
 * The epsilon matters: without it, a colour that lands at -1e-16 after the
 * matrix round-trip reads as out of gamut, and the Cmax bisection then
 * converges one LSB low on every single rung. 1e-6 is well below 8-bit
 * resolution (1/255 = 3.9e-3) so it cannot mask a real excursion.
 */
export function inGamut(L: number, C: number, H: number): boolean {
    const [r, g, b] = oklchToLinear(L, C, H);
    const EPS = 1e-6;
    return r >= -EPS && r <= 1 + EPS && g >= -EPS && g <= 1 + EPS && b >= -EPS && b <= 1 + EPS;
}

function toHexByte(linear: number): number {
    const v = linearToSrgb(linear);
    return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** OKLCh -> `#rrggbb`, clamped into sRGB. Not injective at 8 bits. */
export function oklchToHex(L: number, C: number, H: number): string {
    const [r, g, b] = oklchToLinear(L, C, H);
    const hex = (n: number) => toHexByte(n).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** OKLCh -> 8-bit sRGB triple, clamped. */
/**
 * `#rgb` / `#rrggbb` -> 8-bit triple. Throws on anything else.
 *
 * The validation is a REGEX, not a NaN check on `parseInt`. `parseInt` reads the
 * leading valid digits and stops, so `parseInt('5z', 16)` is 5 and `#ff0f0z`
 * silently became `#ff0f00` — a different colour, accepted without complaint. The
 * anchor field wraps this in try/catch to decide whether an edit is valid, so a
 * typo in the last digit reseated the entire ladder on a colour nobody typed.
 */
const HEX3 = /^[0-9a-fA-F]{3}$/;
const HEX6 = /^[0-9a-fA-F]{6}$/;

export function hexToRgb255(hex: string): [number, number, number] {
    const h = hex.trim().replace(/^#/, '');
    if (HEX3.test(h)) {
        return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    }
    if (!HEX6.test(h)) throw new Error(`Bad hex: ${hex}`);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** `#rrggbb` -> OKLCh. */
export function hexToOklch(hex: string): Oklch {
    const [r8, g8, b8] = hexToRgb255(hex);
    const r = srgbToLinear(r8 / 255);
    const g = srgbToLinear(g8 / 255);
    const b = srgbToLinear(b8 / 255);

    const l = Math.cbrt(M1[0][0] * r + M1[0][1] * g + M1[0][2] * b);
    const m = Math.cbrt(M1[1][0] * r + M1[1][1] * g + M1[1][2] * b);
    const s = Math.cbrt(M1[2][0] * r + M1[2][1] * g + M1[2][2] * b);

    const L = M2[0][0] * l + M2[0][1] * m + M2[0][2] * s;
    const a = M2[1][0] * l + M2[1][1] * m + M2[1][2] * s;
    const bb = M2[2][0] * l + M2[2][1] * m + M2[2][2] * s;

    const C = Math.hypot(a, bb);
    let H = (Math.atan2(bb, a) * 180) / Math.PI;
    if (H < 0) H += 360;

    return { L, C, H };
}

/** WCAG 2.x relative luminance from an 8-bit triple. */
export function relativeLuminance(r8: number, g8: number, b8: number): number {
    const r = srgbToLinear(r8 / 255);
    const g = srgbToLinear(g8 / 255);
    const b = srgbToLinear(b8 / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.x contrast ratio between two hex colours, 1..21.
 *
 * Deliberately computed from the QUANTISED 8-bit values, not from OKLCh:
 * what ships is a hex, and every constraint in this project is stated against
 * shipped values. Measuring in continuous space would report ratios the
 * browser never produces.
 */
export function contrastHex(a: string, b: string): number {
    const [ar, ag, ab] = hexToRgb255(a);
    const [br, bg, bb] = hexToRgb255(b);
    const la = relativeLuminance(ar, ag, ab);
    const lb = relativeLuminance(br, bg, bb);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
}

/**
 * The app's own dark ink, and its light one, for labels drawn ON a swatch.
 *
 * The dark one is pure black, and that is arithmetic rather than taste.
 *
 * `inkOn` already picks whichever of the two measures better, so the worst case on any
 * background is the CROSSOVER — the lightness where both inks read the same. With a given dark
 * ink of luminance `d`, that is where `(L + .05) / (d + .05) = 1.05 / (L + .05)`, so the best
 * contrast available anywhere on the scale is `sqrt(1.05 * (d + .05)) / (d + .05)`.
 *
 *   `#14161b`  d = 0.0069  →  worst case 4.30:1   fails AA
 *   `#000000`  d = 0       →  worst case 4.58:1   clears it
 *
 * Measured on the wall, that is the difference between four rungs failing and none: the last
 * four failures after the opacity ranking came out of `app.css` were exactly the shades sitting
 * at this crossover. Two hex points of ink for four passing labels.
 */
const INK_DARK = '#000000';
const INK_LIGHT = '#ffffff';

/**
 * Which ink to draw on a given colour — measured, not guessed.
 *
 * There were two rules for this, one file apart. The palette wall measured both
 * contrasts and picked the winner, with a comment explaining that *"an L > 0.62
 * cutoff put dark text on electric-blue-500 and orange-500, where it is the WORSE
 * of the two options"*. The Add-a-colour preview then used exactly that cutoff, on
 * exactly those colours, to label the shades of a family being created — so the
 * one place you are judging a brand-new hue was the one place using the rule
 * already known to be wrong for brand hues.
 */
export function inkOn(background: string): string {
    return contrastHex(background, INK_DARK) > contrastHex(background, INK_LIGHT)
        ? INK_DARK
        : INK_LIGHT;
}

/** True when dark ink wins on this background — the wall's `.light` modifier. */
export function prefersDarkInk(background: string): boolean {
    return inkOn(background) === INK_DARK;
}

/** Are two hexes within `lsb` per channel? The only comparison we trust. */
/** Per-channel signed deltas, for reporting a fidelity miss. */
export function hexDelta(a: string, b: string): [number, number, number] {
    const [ar, ag, ab] = hexToRgb255(a);
    const [br, bg, bb] = hexToRgb255(b);
    return [ar - br, ag - bg, ab - bb];
}

export function normaliseHex(hex: string): string {
    const [r, g, b] = hexToRgb255(hex);
    const h = (n: number) => n.toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}
