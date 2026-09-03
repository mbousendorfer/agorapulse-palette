/**
 * The wall's Figma view has to find a value for every cell it draws, under the solver's own key.
 * If the export is re-vendored and a family is renamed or a rung dropped, this names it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { solvePalette } from '../../engine/solve';
import type { PaletteSpec } from '../../engine/types';
import { FIGMA_MODE, FIGMA_REFERENCE, figmaHexOf } from '../reference';

const spec = JSON.parse(readFileSync('spec/palette.baseline.json', 'utf8')) as PaletteSpec;
const solution = solvePalette(spec);

describe('FIGMA_REFERENCE', () => {
    it('has a value for every rung the shipped palette solves', () => {
        for (const ref of solution.rungs.keys()) {
            expect(FIGMA_REFERENCE.get(ref), ref).toMatch(/^#[0-9a-f]{6}$/);
        }
    });

    it('keys the two-word family the way the spec does', () => {
        expect(figmaHexOf('electricBlue', 500)).toBe('#178dfe');
        expect(figmaHexOf('electric-blue', 500)).toBeUndefined();
    });

    it('keeps the disagreement with the shipped CSS rather than smoothing it', () => {
        // The reason the view exists: Figma and the CSS do not say the same thing everywhere.
        expect(figmaHexOf('grey', 900)).toBe('#485974');
        expect(solution.rungs.get('grey.900')!.hex).toBe('#495975');
    });

    it('answers nothing for a rung Figma does not have', () => {
        expect(figmaHexOf('grey', 1100)).toBeUndefined();
        expect(figmaHexOf('nope', 500)).toBeUndefined();
    });

    it('names the mode it was exported from', () => {
        expect(FIGMA_MODE).toBe('Agorapulse');
    });
});
