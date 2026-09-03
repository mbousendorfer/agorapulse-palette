/**
 * A scope is a declaration with one canonical shape, so that declaring nothing, then something,
 * then nothing again leaves the spec byte-identical — the dirty check and the share link both
 * compare the JSON.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    familyScopes,
    isScopeList,
    normaliseScopes,
    scopeSentence,
    setFamilyScopes,
} from '../scope';
import type { PaletteSpec } from '../types';

const baseline = JSON.parse(readFileSync('spec/palette.baseline.json', 'utf8')) as PaletteSpec;

describe('scope', () => {
    it('normalises to one order, without duplicates, and to nothing when empty', () => {
        expect(normaliseScopes(['product', 'brand', 'product'])).toEqual(['brand', 'product']);
        expect(normaliseScopes([])).toBeUndefined();
        expect(normaliseScopes(undefined)).toBeUndefined();
    });

    it('reads as a caption', () => {
        expect(scopeSentence(['brand'])).toBe('brand design');
        expect(scopeSentence(['product', 'brand'])).toBe('brand & product design');
        expect(scopeSentence([])).toBeNull();
    });

    it('is absent on every shipped family', () => {
        for (const f of baseline.chromatic.families) expect(f.scope).toBeUndefined();
        expect(baseline.grey.scope).toBeUndefined();
        expect(familyScopes(baseline, 'grey')).toEqual([]);
    });

    it('round-trips through the spec and leaves it clean when cleared', () => {
        const spec = structuredClone(baseline);
        setFamilyScopes(spec, 'electricBlue', ['product', 'brand']);
        setFamilyScopes(spec, 'grey', ['product']);
        expect(familyScopes(spec, 'electricBlue')).toEqual(['brand', 'product']);
        expect(familyScopes(spec, 'grey')).toEqual(['product']);
        expect(JSON.stringify(spec)).not.toBe(JSON.stringify(baseline));

        setFamilyScopes(spec, 'electricBlue', []);
        setFamilyScopes(spec, 'grey', []);
        expect(JSON.stringify(spec)).toBe(JSON.stringify(baseline));
    });

    it('ignores a family that does not exist', () => {
        const spec = structuredClone(baseline);
        setFamilyScopes(spec, 'nope', ['brand']);
        expect(JSON.stringify(spec)).toBe(JSON.stringify(baseline));
    });

    it('validates what a shared link may carry', () => {
        expect(isScopeList(undefined)).toBe(true);
        expect(isScopeList(['brand'])).toBe(true);
        expect(isScopeList(['marketing'])).toBe(false);
        expect(isScopeList('brand')).toBe(false);
    });
});
