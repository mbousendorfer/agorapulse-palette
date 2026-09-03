/**
 * What Figma says each rung is — the reference the wall can be switched to.
 *
 * Read from the vendored variables export, never merged into the palette: the two do not agree
 * everywhere (grey 900 is #485974 in Figma and #495975 in the shipped CSS) and the disagreement
 * is the useful part. Keyed the way the solver keys its rungs, `electricBlue.500`, so the wall
 * can ask for the Figma value of exactly the cell it is drawing and get the same answer whether
 * the family is grey or chromatic.
 *
 * Only the `--ref-color-<family>-<rung>` colours are read. Figma also ships two mermaid rungs
 * and twenty-seven one-offs under `--ref-color-`; they have no row on the wall, so they land in
 * the map under their own family and nothing asks for them. The chart hues and social brands
 * the wall DOES show come from the compiled CSS, in "Given, not solved".
 */

import type { FigmaToken } from './parse';
import { rungRef, type RungRef } from '../engine/types';

import FIGMA from '../../vendor/figma-variables.json';

interface Collected {
    collection: FigmaToken['collection'];
    mode: string;
    tokens: FigmaToken[];
}

const REFERENCE = (FIGMA.collections as unknown as Collected[]).find(
    (c) => c.collection === 'reference',
);

/** The Figma mode the values were exported from, for the wall to name. */
export const FIGMA_MODE = REFERENCE?.mode ?? 'Figma';

/** `electric-blue` → `electricBlue`: the kebab the CSS uses to the camel the spec uses. */
function familyIdOf(kebab: string): string {
    return kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Figma's hex for every ladder colour it exports, lowercase, keyed `family.rung`.
 *
 * Built once at module load, like the token graph: the export is inlined JSON, so this is a
 * synchronous walk over ~130 tokens and not something to redo per render.
 */
export const FIGMA_REFERENCE: ReadonlyMap<RungRef, string> = (() => {
    const out = new Map<RungRef, string>();
    for (const token of REFERENCE?.tokens ?? []) {
        if (token.type !== 'color' || !token.value) continue;
        const m = /^--ref-color-(.+)-(\d+)$/.exec(token.cssVar);
        if (!m) continue;
        out.set(rungRef(familyIdOf(m[1]), Number(m[2])), token.value.toLowerCase());
    }
    return out;
})();

/** The Figma value of one rung, or `undefined` when Figma has no such colour. */
export function figmaHexOf(family: string, rung: number): string | undefined {
    return FIGMA_REFERENCE.get(rungRef(family, rung));
}
