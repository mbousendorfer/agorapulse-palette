/**
 * Declarative constraints over a solved palette.
 *
 * Every constraint reports a SIGNED slack in its own natural unit — contrast
 * ratio points, or L units. That gives three states rather than two:
 *
 *   violated  slack < -tol
 *   binding   |slack| <= tol      <- the important one
 *   satisfied otherwise
 *
 * "Binding" deserves its own rendering because three of these sit at zero slack
 * in the shipped palette. That is where the design is fragile: any change to a
 * knob feeding a binding constraint breaks it immediately, and a UI that shows
 * only pass/fail hides that entirely.
 */

import { contrastHex, hexToOklch } from '../color/oklab';
import { getRung, type FamilyId, type PaletteSolution, type PaletteSpec } from './types';

export type ConstraintStatus = 'satisfied' | 'binding' | 'violated' | 'not-applicable';

export interface ConstraintResult {
    id: string;
    label: string;
    /** What the constraint means, in one sentence, for the drawer. */
    explanation: string;
    status: ConstraintStatus;
    /** Signed, in the unit named by `unit`. */
    slack: number;
    unit: 'ratio' | 'L';
    /** Measured value and target, for display. */
    measured: number;
    target: number;
    /** The family (or rung) that determined the result. */
    witness?: string;
    /**
     * Set when the constraint is a consequence of an anchor rather than an
     * independent requirement — it cannot be edited, only invalidated by moving
     * the anchor.
     */
    derivedFrom?: string;
    /** True when this is an objective with an accepted residual, not a hard rule. */
    soft?: boolean;
    /** Which spec knob moves this constraint. */
    knob?: string;
}

/** Tolerance for calling a constraint "binding" rather than merely satisfied. */
const RATIO_TOL = 0.01;
const L_TOL = 1e-6;

function classify(slack: number, tol: number): ConstraintStatus {
    if (slack < -tol) return 'violated';
    if (Math.abs(slack) <= tol) return 'binding';
    return 'satisfied';
}

export function evaluateConstraints(
    spec: PaletteSpec,
    solution: PaletteSolution,
): ConstraintResult[] {
    const hex = (family: string, rung: number) => getRung(solution, family, rung).hex;
    // Derived from the spec, never hard-coded: a family added in the UI has to
    // be held to the same constraints as the original seven, or it could ship
    // failing the 4.5 minimum without anything saying so.
    const CHROMATIC: FamilyId[] = spec.chromatic.families.map((f) => f.id);
    const out: ConstraintResult[] = [];

    // --- C1: rung 700 is the purple anchor's lightness ---------------------
    {
        const anchor = spec.chromatic.families.find((f) => f.id === 'purple')?.anchors[700];
        const target = anchor ? hexToOklch(anchor).L : 0;
        const measured = solution.derived.L700;
        const slack = measured - target;
        out.push({
            id: 'C1',
            label: 'Rung 700 sits at the purple anchor’s lightness',
            explanation:
                'The scale is seated on #6554C0. It fell 70% of the way between the old 600 and ' +
                '700, so there was no invisible approximation available — the decision was to ' +
                'make rung 700 be its lightness. Everything else follows from this.',
            status: Math.abs(slack) <= L_TOL ? 'satisfied' : 'violated',
            slack,
            unit: 'L',
            measured,
            target,
            derivedFrom: 'anchor purple.700',
        });
    }

    // --- C2: rung 500 is the mean of the two brand anchors -----------------
    {
        const [a, b] = spec.chromatic.rung500From;
        const find = (ref: string) => {
            const [fam, rung] = ref.split('.');
            return spec.chromatic.families.find((f) => f.id === fam)?.anchors[Number(rung)];
        };
        const ha = find(a);
        const hb = find(b);
        const target = ha && hb ? (hexToOklch(ha).L + hexToOklch(hb).L) / 2 : 0;
        const measured = solution.derived.L500;
        out.push({
            id: 'C2',
            label: 'Rung 500 is the mean of the two brand anchors',
            explanation:
                'Both brand anchors therefore sit OFF the shared ladder — #178DFE by −0.027 and ' +
                '#FF6726 by +0.027. The five non-anchored families use the mean. This is why ' +
                '"the ladder is shared" is not true at rung 500.',
            status: Math.abs(measured - target) <= L_TOL ? 'satisfied' : 'violated',
            slack: measured - target,
            unit: 'L',
            measured,
            target,
            derivedFrom: 'anchors electricBlue.500 + orange.500',
        });
    }

    // --- C3: the low plateau halves the 500-700 interval -------------------
    {
        const target =
            (solution.derived.L500 - solution.derived.L700) / spec.chromatic.lowPlateauDivisor;
        const measured = solution.derived.lowStep;
        out.push({
            id: 'C3',
            label: 'Low plateau step halves the 500→700 interval',
            explanation:
                'Gives rungs 600 and 800. Note this interval is NOT subdivisible: inserting a rung ' +
                'between 500 and 700 lifts the 700 to L 0.5702, where green-700 on green-200 falls ' +
                'to 3.66. That makes intermediate hover states the one addition the constraints forbid.',
            status: Math.abs(measured - target) <= L_TOL ? 'satisfied' : 'violated',
            slack: measured - target,
            unit: 'L',
            measured,
            target,
            knob: 'lowPlateauDivisor',
        });
    }

    // --- C4: contrast(700, 200) >= target, every family --------------------
    {
        const target = spec.chromatic.contrast700on200;
        let measured = Infinity;
        let witness = '';
        for (const family of CHROMATIC) {
            const c = contrastHex(hex(family, 700), hex(family, 200));
            if (c < measured) {
                measured = c;
                witness = family;
            }
        }
        out.push({
            id: 'C4',
            label: 'Rung 700 on rung 200 clears the minimum, in every family',
            explanation:
                'This is what SOLVES rung 200 — its lightness is not chosen, it is the smallest ' +
                'value that holds this ratio across all seven families. Green binds the derivation ' +
                '(it is the lightest hue at equal lightness); at the shipped values electric blue ' +
                'binds instead, because its 700 is the override that spent its headroom down to 4.50.',
            status: classify(measured - target, RATIO_TOL),
            slack: measured - target,
            unit: 'ratio',
            measured,
            target,
            witness,
            knob: 'contrast700on200',
        });
    }

    // --- C5: rung 100's contrast on white matches grey-100's ---------------
    {
        const greyOnWhite = contrastHex(hex('grey', 100), '#FFFFFF');
        // Report the family furthest from the objective — that is the residual
        // the designer is actually accepting. Seed from the first family rather
        // than from 0, or the deviation is measured against a ratio of zero and
        // no real family ever beats it.
        let worst = contrastHex(hex(CHROMATIC[0], 100), '#FFFFFF');
        let witness = CHROMATIC[0];
        for (const family of CHROMATIC.slice(1)) {
            const c = contrastHex(hex(family, 100), '#FFFFFF');
            if (Math.abs(c - greyOnWhite) > Math.abs(worst - greyOnWhite)) {
                worst = c;
                witness = family;
            }
        }
        out.push({
            id: 'C5',
            label: 'Rung 100 sits as light on white as grey-100 does',
            explanation:
                'An OBJECTIVE, not a derivation — and it does not hold. The chromatic 100s land at ' +
                '1.058–1.070 against grey-100’s 1.052, so there is a standing residual. The real ' +
                'free parameter is the 0.0269 step; treat this as a knob with a target and a ' +
                'visible residual, not as something the ladder guarantees.',
            status: 'satisfied',
            slack: worst - greyOnWhite,
            unit: 'ratio',
            measured: worst,
            target: greyOnWhite,
            witness,
            soft: true,
            knob: 'chromatic.step100',
        });
    }

    // --- C6: grey 800 on grey 200 -----------------------------------------
    {
        const target = spec.grey.contrast800on200;
        const measured = contrastHex(hex('grey', 800), hex('grey', 200));
        out.push({
            id: 'C6',
            label: 'Grey 800 on grey 200 clears the minimum',
            explanation:
                'Poses BOTH rungs. It is a minimum rather than a target, and that is the only ' +
                'reason the light end can be degressive at all: it lets the 200 lift. Treated as an ' +
                'equality, the 200 would be fully determined and there would be no lever left.',
            status: classify(measured - target, RATIO_TOL),
            slack: measured - target,
            unit: 'ratio',
            measured,
            target,
            knob: 'grey.contrast800on200',
        });
    }

    // --- C7: grey cadence relation ----------------------------------------
    {
        const { greyStep1: d1, greyStep2: d2, greyStep3: d3 } = solution.derived;
        const measured = d2 ** 2;
        const target = d1 * d3;
        out.push({
            id: 'C7',
            label: 'Grey cadence: d2² = d1·d3',
            explanation:
                'Equalises the two cadence breaks in the grey light end. Distributing that interval ' +
                'uniformly instead leaves 200→300 at 1.84× the previous step, which is visible — it ' +
                'produced the feedback that grey-300 read much stronger than grey-200. grey-300 is ' +
                'then lightened off-ladder by the +0.0099 the budget allows.',
            status: Math.abs(measured - target) <= 1e-9 ? 'satisfied' : 'violated',
            slack: measured - target,
            unit: 'L',
            measured,
            target,
        });
    }

    return out;
}

/** WCAG level for a ratio, at normal text size. */
export function wcagLevel(ratio: number): 'AAA' | 'AA' | 'AA-L' | 'fail' {
    if (ratio >= 7) return 'AAA';
    if (ratio >= 4.5) return 'AA';
    if (ratio >= 3) return 'AA-L';
    return 'fail';
}
