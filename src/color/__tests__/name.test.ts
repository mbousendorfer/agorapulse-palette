/**
 * The suggested name is a starting point, so these pin its SHAPE, not a lexicon.
 *
 * The two claims worth guarding: a family's own brand colour suggests a name in the right hue
 * family (the buckets are calibrated to the anchors), and a near-neutral colour is named as a
 * neutral rather than by a hue that is 8-bit noise at that chroma.
 */

import { describe, expect, it } from 'vitest';

import { suggestColourName } from '../name';

describe('suggestColourName', () => {
    it('names each anchor in its own hue family', () => {
        const hue = (name: string) => name.split(' ').at(-1);
        expect(hue(suggestColourName('#178DFE'))).toBe('Blue'); // electric blue, H 253.5
        expect(hue(suggestColourName('#FF6726'))).toBe('Orange'); // orange, H 40.6
        expect(hue(suggestColourName('#6554C0'))).toBe('Purple'); // purple, H 286.7
        expect(hue(suggestColourName('#11B43A'))).toBe('Green'); // green 500, H ~145
        expect(hue(suggestColourName('#11ABA6'))).toBe('Teal'); // menthol 500, H ~190
    });

    it('adds at most one qualifier, so the name is one or two words', () => {
        for (const hex of ['#178DFE', '#FFEAE2', '#344563', '#f3faf3', '#6554C0']) {
            expect(suggestColourName(hex).split(' ').length).toBeLessThanOrEqual(2);
        }
    });

    it('calls a saturated mid-tone Vivid', () => {
        expect(suggestColourName('#178DFE')).toBe('Vivid Blue');
    });

    it('names a near-neutral by lightness, with no hue', () => {
        expect(suggestColourName('#FFFFFF')).toBe('Snow');
        expect(suggestColourName('#111111')).toBe('Ink');
        const mid = suggestColourName('#808080');
        expect(['Silver', 'Grey', 'Slate']).toContain(mid);
    });

    it('throws on a malformed hex, like the conversion it is built on', () => {
        expect(() => suggestColourName('not-a-hex')).toThrow();
    });
});
