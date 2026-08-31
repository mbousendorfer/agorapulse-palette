/**
 * Grey: a fully independent 10-rung scale.
 *
 * Shape: a degressive light end, then a uniform tail. That shape is not an
 * aesthetic choice — it is the only one that buys contrast(800,200) >= 4.5
 * with #F9F9FA and #344563 both locked. A perfectly uniform step across all
 * ten rungs only reaches 4.3, so any rebalancing toward the light end breaks
 * the constraint.
 *
 * Derivation:
 *   1. L100, L1000 <- the two anchors.
 *   2. L200 <- L100 - step100 (free parameter).
 *   3. L800 <- SOLVED from contrast(800, 200) >= target. Binding at 4.501.
 *   4. The five rungs between 200 and 800 are distributed to equalise the two
 *      cadence breaks, by solving d2 = sqrt(d1 * d3) subject to
 *      d2 + 5*d3 = L200 - L800. One unknown, monotone -> bisection.
 *   5. L900, L1000 <- two even steps from L800 down to the 1000 anchor.
 *
 * The key that unlocks all of this: contrast(800,200) = 4.5 is a MINIMUM, not
 * a target. That is what allows the 200 to lift and the light end to go
 * degressive. Treat it as an equality and the 200's L is fully determined and
 * there is no lever left.
 *
 * Three failed approaches, recorded so they are not retried:
 *   - Re-solving everything to lighten the 300: cadence gets WORSE (1.84x ->
 *     2.05x), because the 4.5 constraint lifts the 200 alongside the 300.
 *   - Lightening the 300 alone: 200->300 improves to 1.34x but 300->400 climbs
 *     to 2.12x and the steps stop being monotone.
 *   - A constant-ratio geometric step over all ten rungs: perfectly smooth
 *     cadence, but contrast(800,200) collapses to 2.83. Unusable.
 */

import { contrastHex, hexToOklch, oklchToHex } from '../color/oklab';
import { bisect } from './bisect';
import type { GreySpec } from './types';

export interface GreyResult {
    /** Rungs 100..1000, 10 values. */
    L: number[];
    step1: number;
    step2: number;
    step3: number;
    tailStep: number;
    /** Slack on contrast(800,200), in contrast-ratio points. */
    slack800on200: number;
    C100: number;
    C1000: number;
}

/**
 * Grey chroma is LINEAR IN L, not linear in rung index.
 *
 * Linear in index gave the 200 a full increment of blue for a half increment
 * of lightness (its step is roughly half the others), which read as "the light
 * greys still have blue in them". Linear in L fixes that mechanically: the
 * short step receives a short increment (0.0039 rather than 0.0064).
 */
export function greyChromaAt(L: number, spec: GreyResultAnchors): number {
    const t = (spec.L100 - L) / (spec.L100 - spec.L1000);
    return spec.C100 + t * (spec.C1000 - spec.C100);
}

/** Hue is likewise linear in L, from rung 200 through rung 1000. */
export function greyHueAt(L: number, spec: GreyResultAnchors, grey: GreySpec): number {
    const t = (spec.L200 - L) / (spec.L200 - spec.L1000);
    return grey.hue200 + t * (grey.hue1000 - grey.hue200);
}

export interface GreyResultAnchors {
    L100: number;
    L200: number;
    L1000: number;
    C100: number;
    C1000: number;
}

/** Build a grey hex at a given L, applying the chroma and hue ramps. */
export function greyHexAt(L: number, anchors: GreyResultAnchors, spec: GreySpec): string {
    return oklchToHex(L, greyChromaAt(L, anchors), greyHueAt(L, anchors, spec));
}

export function solveGrey(spec: GreySpec): GreyResult {
    const a100 = hexToOklch(spec.anchor100);
    const a1000 = hexToOklch(spec.anchor1000);

    const L100 = a100.L;
    const L1000 = a1000.L;
    const L200 = L100 - spec.step100;

    const anchors: GreyResultAnchors = {
        L100,
        L200,
        L1000,
        C100: a100.C,
        C1000: a1000.C,
    };

    const hex200 = greyHexAt(L200, anchors, spec);

    // --- rung 800: solved from the contrast minimum ------------------------
    // Darkening the 800 raises its contrast on the 200, monotonically. Bracket
    // from just under the 200 (ratio ~1) down to the 1000 anchor. If even the
    // 1000 cannot reach the target, bisect() throws rather than returning a
    // quietly wrong ladder.
    const solved800 = bisect(
        (l800) => contrastHex(greyHexAt(l800, anchors, spec), hex200) - spec.contrast800on200,
        L200 - 1e-6,
        L1000,
        'grey rung 800 (contrast(800,200) >= target)',
    );
    const L800 = solved800.x;

    // --- distribute the five rungs between 200 and 800 ---------------------
    // Span = d2 + 5*d3, with d2 = sqrt(d1*d3). Monotone increasing in d3.
    const d1 = spec.step100;
    const span = L200 - L800;
    const solvedD3 = bisect(
        (d3) => Math.sqrt(d1 * d3) + 5 * d3 - span,
        0,
        span,
        'grey tail step (d2 = sqrt(d1*d3), d2 + 5*d3 = span)',
    );
    const d3 = solvedD3.x;
    const d2 = Math.sqrt(d1 * d3);

    const L: number[] = [L100, L200];
    let cur = L200 - d2; // rung 300
    L.push(cur);
    for (let i = 0; i < 5; i++) {
        cur -= d3; // rungs 400..800
        L.push(cur);
    }

    // --- tail: 800 -> 1000 in two even steps -------------------------------
    const tailStep = (L[7] - L1000) / 2;
    L.push(L[7] - tailStep); // 900
    L.push(L1000); // 1000

    const slack =
        contrastHex(greyHexAt(L[7], anchors, spec), greyHexAt(L[1], anchors, spec)) -
        spec.contrast800on200;

    return {
        L,
        step1: d1,
        step2: d2,
        step3: d3,
        tailStep,
        slack800on200: slack,
        C100: a100.C,
        C1000: a1000.C,
    };
}
