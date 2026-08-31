/**
 * How far each anchor actually reaches, measured rather than remembered.
 *
 * `EngineRules` used to state this as prose — "the three brand anchors reach 35, 37 and 49 of
 * the 66 rungs" — a real measurement taken by hand in a past session and then frozen into a
 * sentence. Two things were wrong with that. It goes stale the moment the spec changes, and it
 * does not say WHICH anchor reaches 49, so the number sat nowhere near the control it describes.
 *
 * ## What "reach" means here, operationally
 *
 * Nudge one anchor's lightness, re-solve the whole palette, count how many of the 66 shades come
 * back with a different hex. Worth stating precisely, because a looser definition would mislead:
 *
 *   - Measured in HEX, not in lightness. A rung whose L moves by less than one 8-bit step does
 *     not count, because on screen it did not move. That makes the number an honest answer to
 *     "what will I see change", which is the question somebody about to drag an anchor has.
 *   - The nudge is 0.01 in OKLab L, about a third of the chromatic ladder's own 0.0269 step.
 *     Small enough that the answer is about the derivation rather than about the size of the
 *     push; large enough to clear the 8-bit floor almost everywhere.
 *   - A COUNT, not a set. Which rungs move is visible on the wall the instant you drag.
 *
 * ## It is SENSITIVITY, not dependency, and the difference is measurable
 *
 * Grey 100 and grey 1000 structurally seed all ten grey rungs — every one is derived from those
 * two — yet a 0.01 nudge moves only 8 and 3 hexes. Rungs 300 to 700 are distributed by solving a
 * geometric mean, so a small push at one end is divided among them and most land inside the same
 * 8-bit value.
 *
 * So this answers "nudge this and how much moves", not "how much depends on this". That is the
 * more useful of the two for somebody with a hand on the control, but the UI has to say which
 * one it is printing — the prose it replaces said "reaches", which claimed the other.
 *
 * ## Why a nudge and not a dependency graph
 *
 * There is no dependency graph to read. A rung's lightness comes out of a bisection over a
 * contrast target, a plateau divisor, and the mean of two anchors — the couplings live inside
 * `solvePalette`, not in a structure beside it. Perturbing the input and diffing the output is
 * the only way to get this number that cannot drift from what the solver really does.
 *
 * Five anchors, two solves each at ~3.3 ms. Memoise on the spec.
 */

import { hexToOklch, oklchToHex } from '../color/oklab';
import { solvePalette } from './solve';
import type { PaletteSpec } from './types';

/** OKLab lightness. About a third of the chromatic ladder's own step. */
const NUDGE = 0.01;

/**
 * Keyed the way the caller already names its rows: `electricBlue.500`, `grey.100`.
 *
 * `null` for an anchor whose nudge cannot solve in either direction — a legitimate answer near a
 * binding constraint, and one the UI should report rather than round down to zero.
 */
export type AnchorReach = Map<string, number | null>;

/** Every key `anchorReach` returns, without solving anything. */
export function anchorKeys(spec: PaletteSpec): string[] {
    return [
        ...spec.chromatic.families.flatMap((f) =>
            Object.keys(f.anchors).map((rung) => `${f.id}.${rung}`),
        ),
        'grey.100',
        'grey.1000',
    ];
}

export function anchorReach(spec: PaletteSpec): AnchorReach {
    const out: AnchorReach = new Map();

    let baseline: Map<string, string>;
    try {
        const solved = solvePalette(spec);
        baseline = new Map([...solved.rungs].map(([ref, r]) => [ref, r.hex]));
    } catch {
        // No baseline to diff against, so every answer is unknown rather than zero.
        for (const key of anchorKeys(spec)) out.set(key, null);
        return out;
    }

    const changedBy = (mutate: (draft: PaletteSpec, delta: number) => void): number | null => {
        /*
           Both directions, and the larger solved answer wins.

           An anchor can be blocked one way and free the other — grey 1000 is the clear case,
           since lifting it eventually leaves contrast(800, 200) unsolvable while lowering it
           does not. Trying only one direction would report the accident of which way it was
           poked; taking the max of the directions that DID solve reports the fuller picture.
        */
        const solved = [NUDGE, -NUDGE]
            .map((delta) => {
                const draft = structuredClone(spec);
                mutate(draft, delta);
                try {
                    const next = solvePalette(draft);
                    let n = 0;
                    for (const [ref, hex] of baseline) {
                        if (next.rungs.get(ref)?.hex !== hex) n++;
                    }
                    return n;
                } catch {
                    return null;
                }
            })
            .filter((n): n is number => n !== null);
        return solved.length ? Math.max(...solved) : null;
    };

    for (const family of spec.chromatic.families) {
        for (const rung of Object.keys(family.anchors)) {
            out.set(
                `${family.id}.${rung}`,
                changedBy((draft, delta) => {
                    const f = draft.chromatic.families.find((x) => x.id === family.id);
                    const current = f?.anchors[Number(rung)];
                    if (f && current) f.anchors[Number(rung)] = shiftLightness(current, delta);
                }),
            );
        }
    }

    out.set(
        'grey.100',
        changedBy((draft, delta) => {
            draft.grey.anchor100 = shiftLightness(draft.grey.anchor100, delta);
        }),
    );
    out.set(
        'grey.1000',
        changedBy((draft, delta) => {
            draft.grey.anchor1000 = shiftLightness(draft.grey.anchor1000, delta);
        }),
    );

    return out;
}

/** Move a hex's OKLab lightness, keeping chroma and hue. Clamped to the unit interval. */
function shiftLightness(hex: string, delta: number): string {
    const { L, C, H } = hexToOklch(hex);
    return oklchToHex(Math.min(1, Math.max(0, L + delta)), C, H);
}
