/**
 * The shared chromatic ladder of L values, rungs 100..800.
 *
 * The derivation is a chain, and the order is load-bearing:
 *
 *   1. L700 <- the lightness of the purple anchor #6554c0. This is the fact
 *      that drives the whole scale. #6554c0 fell 70% of the way between the
 *      old 600 and 700, so no invisible approximation was available; the
 *      decision was to re-seat the ladder so that rung 700 IS its lightness.
 *   2. L500 <- the mean of the two brand anchors' lightness. Both anchors
 *      therefore sit OFF this ladder, by -0.0271 and +0.0272.
 *   3. lowStep <- (L500 - L700) / divisor. Gives 600 and 800.
 *   4. L200 is SOLVED, not chosen: the smallest L that holds
 *      contrast(700, 200) >= target across every family. Green binds it,
 *      because green is the lightest hue at equal L.
 *   5. highStep <- (L200 - L500) / divisor. Gives 300 and 400.
 *   6. L100 <- L200 + step100. A knob with a target, not a derivation.
 *
 * Consequence worth remembering before "fixing" anything here: the interval
 * 500->700 is NOT subdivisible. Inserting a rung there lifts 700 to L 0.5702,
 * where green-700 on green-200 falls to 3.66. That is also the most commonly
 * requested addition (intermediate hover/active states), so it is the one
 * addition the constraints forbid.
 */

import { oklchToHex, contrastHex, hexToOklch } from '../color/oklab';
import { bisect } from './bisect';
import { darkEndChroma, lightEndChroma } from './chroma';
import type { ChromaticSpec, FamilySpec } from './types';

export interface LadderResult {
    /** Rung names, e.g. [100..800], extended at the dark end on request. */
    rungs: number[];
    /** L per rung, parallel to `rungs`. */
    L: number[];
    L500: number;
    L700: number;
    lowStep: number;
    highStep: number;
    L200: number;
    /** The family whose contrast(700,200) sat lowest — the binding one. */
    rung200Witness: string;
    /** Slack of the binding family, in contrast-ratio points. */
    rung200Slack: number;
}

/**
 * Contrast of rung 700 on rung 200 for one family, at a candidate L200.
 *
 * Both endpoints are quantised to hex before measuring: that is what ships,
 * and the constraint was stated against shipped values. Anchors and the 200
 * ceiling are applied here exactly as the full solve applies them, so the
 * constraint checker can reuse this function and get the same number.
 */
export function contrast700on200(
    l200: number,
    l700: number,
    l500: number,
    family: FamilySpec,
    spec: ChromaticSpec,
): number {
    const hex700 =
        family.anchors[700] ?? oklchToHex(l700, darkEndChroma(l700, family, spec).C, family.hue);

    const anchor500 = family.anchors[500];
    const c500 = anchor500
        ? // An anchored 500 caps the light end with its own real chroma, not
          // with the value the factor would have produced.
          hexToOklch(anchor500).C
        : darkEndChroma(l500, family, spec).C;

    const c200 = lightEndChroma(l200, 1, family, spec, c500).C;
    const hex200 = family.anchors[200] ?? oklchToHex(l200, c200, family.hue);

    return contrastHex(hex700, hex200);
}

export function solveLadder(spec: ChromaticSpec, anchorL: (ref: string) => number): LadderResult {
    const L700 = anchorL(spec.rung700From);
    const [refA, refB] = spec.rung500From;
    const L500 = (anchorL(refA) + anchorL(refB)) / 2;

    const lowStep = (L500 - L700) / spec.lowPlateauDivisor;
    const L600 = L700 + lowStep;
    const L800 = L700 - lowStep;

    // --- rung 200: solved, not chosen ---------------------------------------
    // Residual = worst contrast across families minus the target. Contrast
    // rises monotonically as the 200 lightens, so the bracket is [L500, 1.0]:
    // at L500 both rungs share a lightness (ratio ~1, residual negative), at
    // 1.0 the 200 is white (residual positive). bisect() asserts that sign
    // change rather than trusting this comment.
    const worst = (l200: number): { ratio: number; witness: string } => {
        let ratio = Infinity;
        let witness = '';
        for (const family of spec.families) {
            const c = contrast700on200(l200, L700, L500, family, spec);
            if (c < ratio) {
                ratio = c;
                witness = family.id;
            }
        }
        return { ratio, witness };
    };

    const solved = bisect(
        (l200) => worst(l200).ratio - spec.contrast700on200,
        L500,
        1.0,
        'rung 200 (contrast(700,200) >= target)',
    );
    const L200 = solved.x;
    const at200 = worst(L200);

    const highStep = (L200 - L500) / spec.highPlateauDivisor;
    const L300 = L200 - highStep;
    const L400 = L200 - 2 * highStep;
    const L100 = L200 + spec.step100;

    // Extra dark rungs continue the low plateau at its own step, which is the
    // only extension the constraints tolerate.
    const extra: number[] = [];
    const extraNames: number[] = [];
    // The ladder must be deep enough for the DEEPEST family: it defines the
    // lightness of every rung anyone uses, and a family materialising rung 1000
    // while the ladder stops at 900 would have nowhere to read its L from.
    const extraCount = Math.max(
        0,
        Math.floor(spec.extraDarkRungs ?? 0),
        ...spec.families.map((f) => Math.max(0, Math.floor(f.extraDarkRungs ?? 0))),
    );
    for (let i = 1; i <= extraCount; i++) {
        extra.push(L800 - i * lowStep);
        extraNames.push(800 + i * 100);
    }

    return {
        rungs: [100, 200, 300, 400, 500, 600, 700, 800, ...extraNames],
        L: [L100, L200, L300, L400, L500, L600, L700, L800, ...extra],
        L500,
        L700,
        lowStep,
        highStep,
        L200,
        rung200Witness: at200.witness,
        rung200Slack: at200.ratio - spec.contrast700on200,
    };
}
