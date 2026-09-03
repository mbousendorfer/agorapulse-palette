/**
 * The top-level palette solve.
 *
 * This module knows nothing about aliases, CSS, or tokens. It takes a
 * PaletteSpec and returns 66 hexes plus the intermediates worth showing in the
 * Engine panel. The token graph writes those hexes into its `derived` nodes;
 * the graph never does colour maths and this file never sees an alias.
 */

import { hexToOklch, normaliseHex, oklchToHex } from '../color/oklab';
import { darkEndChroma, effectiveChromaFactor, lightEndChroma } from './chroma';
import { greyEnd, greyHexAt, solveGrey, type GreyResultAnchors } from './grey';
import { solveLadder } from './ladder';
import {
    GREY_RUNGS,
    isRungRef,
    rungRef,
    type LadderSource,
    type PaletteSolution,
    type PaletteSpec,
    type Provenance,
    type SolvedRung,
} from './types';

/** Which envelope slot a light-end rung uses. */
const ENVELOPE_INDEX: Record<number, 0 | 1 | 2 | 3> = { 100: 0, 200: 1, 300: 2, 400: 3 };

export function solvePalette(spec: PaletteSpec): PaletteSolution {
    const overrides = new Map(spec.overrides.map((o) => [o.rung, o]));

    // --- resolve anchors into lightnesses ----------------------------------
    const anchorHex = (ref: string): string => {
        const [familyId, rungStr] = ref.split('.');
        const family = spec.chromatic.families.find((f) => f.id === familyId);
        const hex = family?.anchors[Number(rungStr)];
        if (!hex) throw new Error(`Spec references a missing anchor: ${ref}`);
        return hex;
    };
    const anchorL = (ref: string) => hexToOklch(anchorHex(ref)).L;
    // The same source, as a sentence, for every surface that explains the ladder.
    const describe = (s: LadderSource) => (isRungRef(s) ? s : `chosen L ${s.L.toFixed(4)}`);

    const ladder = solveLadder(spec.chromatic, anchorL);
    const grey = solveGrey(spec.grey);

    const rungs = new Map<RungRefLocal, SolvedRung>();

    // --- chromatic families -------------------------------------------------
    let purpleFactor = spec.chromatic.chromaFactor;

    for (const family of spec.chromatic.families) {
        // A family whose anchor sits below the global factor gets its own
        // factor back-solved from that anchor, rather than a magic constant.
        // Purple is the only family in this position today — see `chroma.ts`.
        const factor = effectiveChromaFactor(family, spec.chromatic);
        const effective = { ...family, chromaFactor: factor };
        if (family.id === 'purple' && factor !== null) purpleFactor = factor;

        // The family's own C500, which caps its light end.
        const anchor500 = family.anchors[500];
        const c500 = anchor500
            ? hexToOklch(anchor500).C
            : darkEndChroma(ladder.L500, effective, spec.chromatic).C;

        // Each family materialises the base eight plus its OWN extras. The
        // ladder may run deeper — that is what lets one family have a 1000 while
        // another stops at 800 — so the surplus rungs are simply skipped here.
        const familyExtra = Math.max(
            0,
            Math.floor(family.extraDarkRungs ?? spec.chromatic.extraDarkRungs ?? 0),
        );
        const familyDepth = 8 + familyExtra;

        ladder.rungs.forEach((rung, i) => {
            if (i >= familyDepth) return;
            const ref = rungRef(family.id, rung);
            const ladderL = ladder.L[i];

            const anchor = family.anchors[rung];
            const override = overrides.get(ref);

            let L = ladderL;
            let H = family.hue;

            // The hard switch at 400/500 — two regimes, no interpolation between
            // them. `chroma.ts` explains why the light end needs an absolute
            // ceiling rather than a fraction of the boundary.
            const chroma =
                rung <= 400
                    ? lightEndChroma(ladderL, ENVELOPE_INDEX[rung], effective, spec.chromatic, c500)
                    : darkEndChroma(ladderL, effective, spec.chromatic);
            let C = chroma.C;

            let hex = oklchToHex(L, C, H);
            let provenance: Provenance = {
                kind: 'ladder',
                gamutLimited: chroma.gamutLimited,
                chromaLimit: chroma.decidedBy,
            };

            if (anchor) {
                hex = normaliseHex(anchor);
                const m = hexToOklch(hex);
                L = m.L;
                C = m.C;
                H = m.H;
                provenance = { kind: 'anchor' };
            } else if (override) {
                hex = normaliseHex(override.hex);
                const m = hexToOklch(hex);
                const deltaL = m.L - ladderL;
                const step = i >= 4 ? ladder.lowStep : ladder.highStep;
                L = m.L;
                C = m.C;
                H = m.H;
                provenance = {
                    kind: 'override',
                    reason: override.reason,
                    deltaL,
                    stepFraction: step === 0 ? 0 : deltaL / step,
                };
            }

            rungs.set(ref, { family: family.id, rung, hex, L, C, H, provenance });
        });
    }

    // --- grey ---------------------------------------------------------------
    const greyAnchors: GreyResultAnchors = {
        L100: grey.L[0],
        L200: grey.L[1],
        L1000: grey.L[9],
        C100: grey.C100,
        C1000: grey.C1000,
    };

    GREY_RUNGS.forEach((rung, i) => {
        const ref = rungRef('grey', rung);
        const ladderL = grey.L[i];
        const override = overrides.get(ref);

        // The two grey ends are pinned by their hex, like chromatic anchors — while
        // they still ARE hexes. An unhooked end has no hex and re-derives on the ramp.
        const end =
            rung === 100 ? spec.grey.anchor100 : rung === 1000 ? spec.grey.anchor1000 : undefined;
        const pinned = end === undefined ? undefined : greyEnd(end).hex;

        let hex = greyHexAt(ladderL, greyAnchors, spec.grey);
        // `ramp`, not a ceiling: grey's chroma is interpolated linearly in L between
        // its two anchors' own chroma, so neither the envelope nor the factor is
        // involved and neither slider reaches it.
        let provenance: Provenance = { kind: 'ladder', gamutLimited: false, chromaLimit: 'ramp' };

        if (pinned) {
            hex = normaliseHex(pinned);
            provenance = { kind: 'anchor' };
        } else if (override) {
            hex = normaliseHex(override.hex);
            const deltaL = hexToOklch(hex).L - ladderL;
            const step = i <= 1 ? grey.step1 : i === 2 ? grey.step2 : grey.step3;
            provenance = {
                kind: 'override',
                reason: override.reason,
                deltaL,
                stepFraction: step === 0 ? 0 : deltaL / step,
            };
        }

        const m = hexToOklch(hex);
        rungs.set(ref, { family: 'grey', rung, hex, L: m.L, C: m.C, H: m.H, provenance });
    });

    return {
        rungs,
        chromaticRungs: ladder.rungs,
        chromaticLadder: ladder.L,
        greyLadder: grey.L,
        derived: {
            L500: ladder.L500,
            L700: ladder.L700,
            lowStep: ladder.lowStep,
            highStep: ladder.highStep,
            L200: ladder.L200,
            rung200Witness: ladder.rung200Witness,
            greyStep1: grey.step1,
            greyStep2: grey.step2,
            greyStep3: grey.step3,
            greyTailStep: grey.tailStep,
            purpleChromaFactor: purpleFactor,
            ladderSources: {
                L700: describe(spec.chromatic.rung700From),
                L500: [
                    describe(spec.chromatic.rung500From[0]),
                    describe(spec.chromatic.rung500From[1]),
                ],
            },
        },
    };
}

type RungRefLocal = string;
