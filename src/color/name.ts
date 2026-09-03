/**
 * A name suggested from a colour, the way Coolors offers one — but computed, not looked up.
 *
 * The alternative was a vendored list of a few thousand hex→name pairs and a nearest-neighbour
 * search. That is a large opaque blob for a tool whose whole claim is that its values are
 * derived rather than remembered, and its whimsical entries (Xanadu, Munsell Red) read wrong
 * against a design system whose families are Electric Blue and Menthol. So this reads the
 * colour's own OKLCH instead: a hue bucket for the noun, and one qualifier from lightness and
 * chroma. Two words at most, and every one of them is a word a designer would actually reach
 * for.
 *
 * It is a SUGGESTION. The dialog pre-fills it and the user edits or accepts it, so being
 * approximately right is the whole bar — a hue that sits on a bucket boundary can land either
 * side and neither answer is wrong.
 *
 * Hue buckets are calibrated in OKLCH hue against this palette's own anchors, so a family's own
 * brand colour suggests a name in the family it belongs to: electric blue (H 253.5) → Blue,
 * orange (40.6) → Orange, green (145.6) → Green, purple (286.7) → Purple, menthol (190.5) →
 * Teal, red (28.6) → Red, yellow (79.9) → Yellow.
 */

import { hexToOklch } from './oklab';

/** Ascending OKLCH hue ceilings, each naming the arc below it. The last wraps back to Red. */
const HUE_BUCKETS: ReadonlyArray<readonly [maxDeg: number, name: string]> = [
    [33, 'Red'],
    [50, 'Orange'],
    [68, 'Amber'],
    [95, 'Yellow'],
    [125, 'Lime'],
    [158, 'Green'],
    [178, 'Emerald'],
    [202, 'Teal'],
    [228, 'Sky'],
    [258, 'Blue'],
    [282, 'Indigo'],
    [305, 'Purple'],
    [330, 'Magenta'],
    [360, 'Pink'],
];

/** Neutral names by lightness, lightest first, for a colour with almost no chroma. */
const NEUTRALS: ReadonlyArray<readonly [minL: number, name: string]> = [
    [0.92, 'Snow'],
    [0.75, 'Silver'],
    [0.55, 'Grey'],
    [0.35, 'Slate'],
    [0.2, 'Charcoal'],
    [0, 'Ink'],
];

/** Below this chroma a colour reads as neutral: named by lightness, with no hue. */
const NEUTRAL_C = 0.025;
/** Between neutral and this, the hue is present but washed out — "Muted". */
const MUTED_C = 0.055;
/** At or above this, the hue is unusually saturated for its lightness — "Vivid". */
const VIVID_C = 0.17;

function hueName(H: number): string {
    const h = ((H % 360) + 360) % 360;
    for (const [max, name] of HUE_BUCKETS) if (h < max) return name;
    return HUE_BUCKETS[0][1];
}

function neutralName(L: number): string {
    for (const [min, name] of NEUTRALS) if (L >= min) return name;
    return NEUTRALS[NEUTRALS.length - 1][1];
}

/**
 * At most one qualifier, so the name stays two words.
 *
 * Order is a priority, not a sequence: a washed-out hue is "Muted" whatever its lightness,
 * then the lightness extremes, then a saturated mid-tone is "Vivid". A plain mid-lightness,
 * mid-chroma colour takes no qualifier — "Blue" is a better name than "Soft Blue".
 */
function qualifier(L: number, C: number): string | null {
    if (C < MUTED_C) return 'Muted';
    if (L >= 0.9) return 'Pale';
    if (L >= 0.8) return 'Light';
    if (L <= 0.3) return 'Dark';
    if (L <= 0.45) return 'Deep';
    if (C >= VIVID_C) return 'Vivid';
    return null;
}

/**
 * A one- or two-word name for a hex. Throws on a malformed hex, like `hexToOklch` — the caller
 * in the dialog already guards its input, so a throw here means the field is mid-edit.
 */
export function suggestColourName(hex: string): string {
    const { L, C, H } = hexToOklch(hex);
    if (C < NEUTRAL_C) return neutralName(L);
    const noun = hueName(H);
    const q = qualifier(L, C);
    return q ? `${q} ${noun}` : noun;
}
