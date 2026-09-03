/**
 * Unhooking an anchor: the one edit that removes an input without moving the outputs.
 *
 * An anchor does two jobs at once. It pins its own rung to a hex, and it FEEDS the derivation —
 * the two brand 500s set the ladder's 500, purple's 700 seats the whole ladder and back-solves
 * purple's gamut fraction, and the two grey ends seed grey's L and C ramps. Deleting the map
 * entry would do the first half and break the second: `solvePalette` throws on a ladder source
 * that no longer exists, and purple would snap to the global 0.98 factor.
 *
 * So unhooking is defined as: write down what the anchor was contributing, then let it go. The
 * lightness it fed the ladder becomes a number in the spec (`LadderSource`), the factor it was
 * back-solving becomes the family's own `chromaFactor`, and a grey end becomes its `{ L, C }`.
 * Every one of those numbers is the float the solver was already reading, so the ladder does not
 * move and no other family changes hex. Only the unhooked rung re-derives — and for purple 700
 * and grey 1000 even that lands byte-exact, because the ladder is seated on them.
 *
 * ## What is deliberately NOT frozen
 *
 * An anchored 500 caps its family's light-end chroma with its own real C (`c500` in `solve.ts`).
 * After unhooking, the cap is the factor-derived C at the ladder's 500 instead. On the shipped
 * palette both brand C500 are well above the light envelope (0.193 and 0.199 against a ceiling
 * of 0.136), so the cap never binds and rungs 100-400 do not move. A low-chroma anchor added
 * later could shift its own light end by a step of colour — and rather than freeze a third
 * number into the spec for that, `detachPreview` measures it and the inspector says so before
 * the click. Measured, not remembered: the same stance as `reach.ts`.
 *
 * Pure functions over a spec. The store's `updateSpec` is what makes them undoable.
 */

import { hexToOklch } from '../color/oklab';
import { effectiveChromaFactor } from './chroma';
import { countChangedHexes } from './reach';
import { solvePalette } from './solve';
import {
    isGreyHex,
    isRungRef,
    rungRef,
    type LadderSource,
    type PaletteSolution,
    type PaletteSpec,
} from './types';

export type GreyEndRung = 100 | 1000;

/** Whether this anchor is one the shared ladder reads its lightness from. */
export function feedsLadder(spec: PaletteSpec, family: string, rung: number): boolean {
    const ref = rungRef(family, rung);
    const { rung700From, rung500From } = spec.chromatic;
    return [rung700From, ...rung500From].some((s) => isRungRef(s) && s === ref);
}

/**
 * Unhook a chromatic anchor, in place on a draft spec.
 *
 * Order matters: the ladder sources are rewritten BEFORE the anchor is deleted, because the
 * frozen lightness is read from the anchor's hex; and the chroma factor is compared before and
 * after the deletion so the rule that decides it lives in `effectiveChromaFactor` alone.
 */
export function detachAnchor(draft: PaletteSpec, family: string, rung: number): void {
    const f = draft.chromatic.families.find((x) => x.id === family);
    const hex = f?.anchors[rung];
    if (!f || !hex) return;

    const ref = rungRef(family, rung);
    const frozen: LadderSource = { L: hexToOklch(hex).L };
    const c = draft.chromatic;
    if (isRungRef(c.rung700From) && c.rung700From === ref) c.rung700From = frozen;
    c.rung500From = c.rung500From.map((s) =>
        isRungRef(s) && s === ref ? frozen : s,
    ) as typeof c.rung500From;

    /*
       Bake the factor only when removing this anchor would CHANGE it. `before` is what the
       family solved with a moment ago; if `after` differs, the anchor was the source of it —
       purple's 0.571 — or, in the rarer two-anchor case, its removal would newly promote another
       anchor's factor. Either way the family keeps what the designer was looking at.
       `null` means "the global factor", which is then written as the global's current value.
    */
    const before = effectiveChromaFactor(f, c);
    delete f.anchors[rung];
    const after = effectiveChromaFactor(f, c);
    if (before !== after) f.chromaFactor = before ?? c.chromaFactor;
}

/** Unhook one end of the grey scale: the hex becomes the L and C the ramps were reading. */
export function detachGreyAnchor(draft: PaletteSpec, rung: GreyEndRung): void {
    const key = rung === 100 ? 'anchor100' : 'anchor1000';
    const end = draft.grey[key];
    if (!isGreyHex(end)) return;
    const { L, C } = hexToOklch(end);
    draft.grey[key] = { L, C };
}

/** Either kind, dispatched on the family — the shape the inspector calls with. */
export function detachAny(draft: PaletteSpec, family: string, rung: number): void {
    if (family === 'grey') {
        if (rung === 100 || rung === 1000) detachGreyAnchor(draft, rung);
        return;
    }
    detachAnchor(draft, family, rung);
}

export interface DetachPreview {
    /** The hex the unhooked rung re-derives to. */
    landsAt: string;
    /** Shades whose hex changes, INCLUDING the unhooked rung when it moves. */
    changedHexes: number;
    /** Whether the shared ladder was reading this anchor. */
    feedsLadder: boolean;
}

/**
 * What unhooking would do, found by doing it on a copy and solving.
 *
 * `null` when the trial does not solve — not reachable from the shipped spec, since freezing
 * the very numbers the solver reads cannot make a constraint unreachable, but a spec from a
 * shared link is an input like any other and the inspector has to have an answer.
 */
export function detachPreview(
    spec: PaletteSpec,
    current: PaletteSolution,
    family: string,
    rung: number,
): DetachPreview | null {
    try {
        const trial = structuredClone(spec);
        detachAny(trial, family, rung);
        const next = solvePalette(trial);
        const landsAt = next.rungs.get(rungRef(family, rung))?.hex;
        if (!landsAt) return null;
        return {
            landsAt,
            changedHexes: countChangedHexes(current, next),
            feedsLadder: family !== 'grey' && feedsLadder(spec, family, rung),
        };
    } catch {
        return null;
    }
}

/**
 * How many anchors the palette still has: every chromatic one plus each grey end that is still
 * a hex. The figure the page tag and the engine panel print, counted so neither can say "five"
 * after one is unhooked — the same rule this codebase applies to "66 shades".
 */
export function countAnchors(spec: PaletteSpec): number {
    const chromatic = spec.chromatic.families.reduce(
        (n, f) => n + Object.keys(f.anchors).length,
        0,
    );
    const grey = [spec.grey.anchor100, spec.grey.anchor1000].filter(isGreyHex).length;
    return chromatic + grey;
}
