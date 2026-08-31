/**
 * CSS sRGB HSL, so the shade inspector can offer a second set of sliders.
 *
 * ## This is NOT the same space as the other three sliders
 *
 * The inspector's default channels are OKLCH — perceptual lightness, chroma and hue — and that
 * is deliberate: the whole palette is a ladder in OKLab, so those are the numbers the engine
 * actually reasons about. HSL is sRGB, cylindrical over the gamma-encoded channels, and none of
 * its numbers agree with OKLCH's:
 *
 *     #ada8f2   OKLCH  L 0.7645  C 0.1051  H 286.7
 *               HSL           244 deg   74%   80%
 *
 * Two lightnesses and two hues for one colour, neither wrong. So the panel shows ONE triple at
 * a time under its own name, rather than six sliders that would read as contradicting each
 * other.
 *
 * HSL is offered because it is what Figma, most pickers and most CSS say, so it is what people
 * have to hand. It is not the space the ladder is edited in: nudging HSL lightness does not move
 * a rung by a predictable perceptual step, which is the entire reason the engine is in OKLab.
 *
 * ## Precision, and why the triple is held as state
 *
 * `hexToHsl` → `hslToHex` is NOT injective. Integer HSL names about 3.6 million colours against
 * sRGB's 16.7 million, so several hexes share one triple — `#64a0e6` and `#64a1e6` are both
 * `212 / 72% / 65%`, found by sweeping rather than guessed (the pair this comment first claimed
 * turned out to differ by a degree).
 *
 * The inspector therefore holds the triple in state while the sliders are in use and writes hex
 * OUT. It also re-seeds from the committed hex, so the three numbers always describe the colour
 * that was actually written — measured under a sweep rather than assumed safe: hue 120 -> 200 ->
 * 120 in 4-degree steps leaves saturation and lightness unmoved, so the rounding does not
 * accumulate. The one visible step is the first commit, where the shipped value's 74% comes back
 * as 75%.
 */

import { hexToRgb255, normaliseHex } from './oklab';

export interface Hsl {
    /** Degrees, 0–360. */
    h: number;
    /** Percent, 0–100. */
    s: number;
    /** Percent, 0–100. */
    l: number;
}

/** `#rrggbb` -> HSL, rounded to what the formatter shows. Throws on a bad hex. */
export function hexToHsl(hex: string): Hsl {
    const [r8, g8, b8] = hexToRgb255(normaliseHex(hex));
    const r = r8 / 255;
    const g = g8 / 255;
    const b = b8 / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };

    const d = max - min;
    // The classic branch: saturation is measured against whichever end of the scale is nearer.
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    let h: number;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;

    return { h: Math.round(h * 360) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

function channel(p: number, q: number, t: number): number {
    let u = t;
    if (u < 0) u += 1;
    if (u > 1) u -= 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
}

/** HSL -> `#rrggbb`. Hue wraps; saturation and lightness clamp. */
export function hslToHex({ h, s, l }: Hsl): string {
    const hh = (((h % 360) + 360) % 360) / 360;
    const ss = Math.min(100, Math.max(0, s)) / 100;
    const ll = Math.min(100, Math.max(0, l)) / 100;

    let r: number;
    let g: number;
    let b: number;
    if (ss === 0) {
        r = g = b = ll;
    } else {
        const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
        const p = 2 * ll - q;
        r = channel(p, q, hh + 1 / 3);
        g = channel(p, q, hh);
        b = channel(p, q, hh - 1 / 3);
    }

    const byte = (v: number) =>
        Math.round(Math.min(1, Math.max(0, v)) * 255)
            .toString(16)
            .padStart(2, '0');
    return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/*
   There is no `formatHsl`/`parseHsl` here, and there was.

   They existed for a text field you typed `hsl(244 74% 80%)` into — the first attempt at this
   feature. Three sliders replaced it, and each one carries its own numeric box through
   `ChannelField`, so a whole-string parser has nothing left to parse. Deleted rather than kept
   "in case": the tests that pinned its tolerant input handling were the only thing using it.
*/
