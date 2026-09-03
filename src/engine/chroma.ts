/**
 * Chroma assignment for the chromatic families.
 *
 * Two regimes, and the boundary between them is the single correction that was
 * applied to the "everything at the gamut" instruction:
 *
 *  - Dark end (500-800): push to `factor x Cmax`. This is what makes the brand
 *    colours saturated.
 *  - Light end (100-400): a shared ABSOLUTE ceiling. Necessary because the
 *    sRGB gamut balloons in light greens and cyans — unguarded, green-300 came
 *    out at C 0.258 while green-500 sits at 0.203, i.e. a 300 more saturated
 *    than its own 500, in fluorescent green. That is a defect, not a style.
 *
 * The envelope is absolute rather than a fraction of C500 because a
 * proportional envelope penalises hues whose 500 is narrow: it turned yellow
 * into tan (#e1cba5, #d1ab69). Absolute is what gives the light end its
 * cross-family harmony, to within 1.14-1.30x.
 */

import { cmaxFor } from '../color/cmax';
import { hexToOklch } from '../color/oklab';
import type { ChromaLimit, ChromaticSpec, FamilySpec } from './types';

export interface ChromaResult {
    C: number;
    /** True when the sRGB boundary, not the envelope or the factor, decided. */
    gamutLimited: boolean;
    /** WHICH term decided — see `ChromaLimit`. `gamutLimited` is `decidedBy === 'gamut'`. */
    decidedBy: ChromaLimit;
}

/**
 * Back-solve a family's gamut fraction from an anchor.
 *
 * Purple is not "set soft" by choice: #6554c0 simply sits at 57.1% of its own
 * gamut, and matching the anchor forces every purple rung 500-800 to that
 * fraction. Deriving it here rather than hardcoding 0.571 means the number
 * stays correct if the anchor ever moves.
 */
export function deriveChromaFactor(anchorL: number, anchorC: number, hue: number): number {
    const cmax = cmaxFor(anchorL, hue);
    if (cmax <= 0) return 0;
    return anchorC / cmax;
}

/**
 * The gamut fraction a family actually solves with, or `null` for "the global one".
 *
 * Three cases, in order: a factor written in the spec wins; otherwise the family's first dark
 * anchor (500-800) back-solves one, adopted only when it sits clearly INSIDE the boundary —
 * the two brand 500s are essentially at it, and rounding them to 0.977 rather than 0.98 would
 * shift every other rung of those families; otherwise `null`.
 *
 * One function rather than the same three branches in `solvePalette` and again in the unhook
 * path: unhooking an anchor has to know what factor the family was USING so it can write that
 * number down, and a second copy of this rule is how the two would drift.
 */
export function effectiveChromaFactor(family: FamilySpec, spec: ChromaticSpec): number | null {
    if (family.chromaFactor !== null) return family.chromaFactor;
    const darkAnchorRung = [500, 600, 700, 800].find((r) => family.anchors[r]);
    if (darkAnchorRung === undefined) return null;
    const { L, C } = hexToOklch(family.anchors[darkAnchorRung] as string);
    const derived = deriveChromaFactor(L, C, family.hue);
    return derived < spec.chromaFactor - 0.02 ? derived : null;
}

/** Chroma for a dark-end rung (500-800). */
export function darkEndChroma(L: number, family: FamilySpec, spec: ChromaticSpec): ChromaResult {
    const factor = family.chromaFactor ?? spec.chromaFactor;
    const cmax = cmaxFor(L, family.hue);
    // `factor >= 1` is a statement about the KNOB, not a measurement of this rung:
    // the dark end is `factor x cmax` by construction, so it can never exceed the
    // boundary. At the shipped 0.98 this is false everywhere, which is why the
    // chroma view needs `decidedBy` rather than this flag.
    const atBoundary = factor >= 1;
    return {
        C: factor * cmax,
        gamutLimited: atBoundary,
        decidedBy: atBoundary ? 'gamut' : 'factor',
    };
}

/**
 * Chroma for a light-end rung (100-400).
 *
 * `c500` caps the result so a tint can never out-saturate its own brand rung.
 * That is what keeps menthol-400 in line: the envelope's 0.136 is above
 * menthol's own C500, so the cap, not the envelope, decides.
 *
 * Note the purple factor deliberately does NOT apply here. Applying it would
 * make purple-100/200 roughly 3x less chromatic than their neighbours and
 * effectively neutral, breaking the light end's shared harmony.
 */
export function lightEndChroma(
    L: number,
    envelopeIndex: 0 | 1 | 2 | 3,
    family: FamilySpec,
    spec: ChromaticSpec,
    c500: number,
): ChromaResult {
    const envelope = spec.lightEnvelope[envelopeIndex];
    const cmax = cmaxFor(L, family.hue) * spec.chromaFactor;
    const capped = Math.min(envelope, c500);
    if (cmax < capped) return { C: cmax, gamutLimited: true, decidedBy: 'gamut' };
    return {
        C: capped,
        gamutLimited: false,
        // Which of the two ceilings bound it. Ties go to the envelope: it is the
        // shared one, and reporting a tie as a per-family cap would send you
        // looking for a family-specific cause that is not there.
        decidedBy: c500 < envelope ? 'c500' : 'envelope',
    };
}
