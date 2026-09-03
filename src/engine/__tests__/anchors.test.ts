/**
 * Unhooking an anchor must not move the palette.
 *
 * That is the whole promise of `anchors.ts`: the numbers an anchor was feeding are written into
 * the spec before the anchor goes, so the ladder stays put and no other family changes hex.
 * These tests hold it against the shipped spec, anchor by anchor, and then with every anchor
 * gone — the state the app has to keep solving in.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { hexToOklch } from '../../color/oklab';
import {
    countAnchors,
    detachAnchor,
    detachAny,
    detachGreyAnchor,
    detachPreview,
    feedsLadder,
} from '../anchors';
import { evaluateConstraints } from '../constraints';
import { anchorKeys, anchorReach, countChangedHexes } from '../reach';
import { solvePalette } from '../solve';
import { isRungRef, type PaletteSpec } from '../types';

const baseline = JSON.parse(readFileSync('spec/palette.baseline.json', 'utf8')) as PaletteSpec;
const before = solvePalette(baseline);

const clone = () => structuredClone(baseline);

function unhooked(family: string, rung: number) {
    const spec = clone();
    detachAny(spec, family, rung);
    return { spec, after: solvePalette(spec) };
}

const close = (a: number[], b: number[]) => {
    expect(a).toHaveLength(b.length);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));
};

describe('detachAnchor: purple 700, the anchor the ladder is seated on', () => {
    const { spec, after } = unhooked('purple', 700);

    it('freezes the lightness it was feeding, as the same float', () => {
        expect(spec.chromatic.rung700From).toEqual({ L: hexToOklch('#6554C0').L });
        close(after.chromaticLadder, before.chromaticLadder);
        expect(after.derived.L700).toBe(before.derived.L700);
    });

    it('writes down the factor it was back-solving', () => {
        const purple = spec.chromatic.families.find((f) => f.id === 'purple')!;
        expect(purple.anchors[700]).toBeUndefined();
        expect(purple.chromaFactor).toBeCloseTo(before.derived.purpleChromaFactor, 12);
    });

    it('moves nothing — the rung re-derives to the hex it was pinned at', () => {
        expect(countChangedHexes(before, after)).toBe(0);
        expect(after.rungs.get('purple.700')!.provenance.kind).toBe('ladder');
    });

    it('keeps C1 satisfied, now against the chosen lightness', () => {
        const c1 = evaluateConstraints(spec, after).find((c) => c.id === 'C1')!;
        expect(c1.status).toBe('satisfied');
        expect(c1.label).toBe('Rung 700 sits at its chosen lightness');
        expect(after.derived.ladderSources.L700).toMatch(/^chosen L /);
    });
});

describe('detachAnchor: electric blue 500, one of the two rung-500 sources', () => {
    const { spec, after } = unhooked('electricBlue', 500);

    it('keeps rung 500 exactly where the mean put it', () => {
        expect(isRungRef(spec.chromatic.rung500From[0])).toBe(false);
        expect(spec.chromatic.rung500From[1]).toBe('orange.500');
        expect(after.derived.L500).toBe(before.derived.L500);
        close(after.chromaticLadder, before.chromaticLadder);
    });

    it('moves only the unhooked rung, onto the ladder', () => {
        expect(countChangedHexes(before, after)).toBe(1);
        const rung = after.rungs.get('electricBlue.500')!;
        expect(rung.provenance.kind).toBe('ladder');
        expect(rung.L).toBeCloseTo(before.derived.L500, 12);
        // The family's light end is capped by the ladder's C500 now, not the anchor's own — and
        // both sit above the light envelope, so rungs 100-400 do not move.
        for (const r of [100, 200, 300, 400]) {
            expect(after.rungs.get(`electricBlue.${r}`)!.hex).toBe(
                before.rungs.get(`electricBlue.${r}`)!.hex,
            );
        }
    });

    it('does not invent a chroma factor the family was not using', () => {
        expect(spec.chromatic.families.find((f) => f.id === 'electricBlue')!.chromaFactor).toBe(
            null,
        );
    });

    it('keeps C2 satisfied', () => {
        const c2 = evaluateConstraints(spec, after).find((c) => c.id === 'C2')!;
        expect(c2.status).toBe('satisfied');
        expect(c2.label).toBe('Rung 500 is the mean of its two sources');
    });
});

describe('detachGreyAnchor', () => {
    it.each([100, 1000] as const)('grey %i: the ramps keep reading the same L and C', (rung) => {
        const { spec, after } = unhooked('grey', rung);
        const key = rung === 100 ? 'anchor100' : 'anchor1000';
        const was = hexToOklch(baseline.grey[key] as string);
        expect(spec.grey[key]).toEqual({ L: was.L, C: was.C });
        close(after.greyLadder, before.greyLadder);
        expect(after.rungs.get(`grey.${rung}`)!.provenance.kind).toBe('ladder');
        // The end re-derives on the ramp. Grey 1000 lands exactly (hue1000 was measured from
        // it); grey 100 extrapolates the hue ramp and may land one LSB off. Nothing else moves.
        expect(countChangedHexes(before, after)).toBeLessThanOrEqual(1);
        for (const other of before.rungs.keys()) {
            if (other === `grey.${rung}`) continue;
            expect(after.rungs.get(other)!.hex).toBe(before.rungs.get(other)!.hex);
        }
    });

    it('drops the end from the anchors the reach panel measures', () => {
        const spec = clone();
        detachGreyAnchor(spec, 100);
        expect(anchorKeys(spec)).not.toContain('grey.100');
        expect(anchorKeys(spec)).toContain('grey.1000');
        expect([...anchorReach(spec).keys()].sort()).toEqual(anchorKeys(spec).sort());
    });
});

describe('the whole set', () => {
    it('is counted, not assumed', () => {
        expect(countAnchors(baseline)).toBe(5);
        const spec = clone();
        detachAnchor(spec, 'orange', 500);
        detachGreyAnchor(spec, 1000);
        expect(countAnchors(spec)).toBe(3);
    });

    it('knows which anchors the ladder reads', () => {
        expect(feedsLadder(baseline, 'purple', 700)).toBe(true);
        expect(feedsLadder(baseline, 'electricBlue', 500)).toBe(true);
        expect(feedsLadder(baseline, 'green', 500)).toBe(false);
    });

    it('still solves with every anchor gone, without moving the ladder', () => {
        const spec = clone();
        for (const [family, rung] of [
            ['purple', 700],
            ['electricBlue', 500],
            ['orange', 500],
        ] as const) {
            detachAnchor(spec, family, rung);
        }
        detachGreyAnchor(spec, 100);
        detachGreyAnchor(spec, 1000);

        expect(countAnchors(spec)).toBe(0);
        expect(anchorKeys(spec)).toEqual([]);
        expect(anchorReach(spec).size).toBe(0);

        const after = solvePalette(spec);
        close(after.chromaticLadder, before.chromaticLadder);
        close(after.greyLadder, before.greyLadder);
        expect([...after.rungs.values()].every((r) => r.provenance.kind !== 'anchor')).toBe(true);
        expect(evaluateConstraints(spec, after).filter((c) => c.status === 'violated')).toEqual([]);
    });

    it('is idempotent and ignores rungs that are not anchors', () => {
        const spec = clone();
        detachAnchor(spec, 'purple', 700);
        const once = structuredClone(spec);
        detachAnchor(spec, 'purple', 700);
        detachAnchor(spec, 'green', 500);
        detachGreyAnchor(spec, 100);
        detachGreyAnchor(spec, 100);
        detachGreyAnchor(once, 100);
        expect(spec).toEqual(once);
    });
});

describe('detachPreview', () => {
    it('says where the rung lands and how much moves, from a solve', () => {
        // Solved hexes are lowercase, like every hex the solver emits.
        expect(detachPreview(baseline, before, 'purple', 700)).toEqual({
            landsAt: '#6554c0',
            changedHexes: 0,
            feedsLadder: true,
        });
        const blue = detachPreview(baseline, before, 'electricBlue', 500)!;
        expect(blue.changedHexes).toBe(1);
        expect(blue.feedsLadder).toBe(true);
        expect(blue.landsAt).toBe(
            unhooked('electricBlue', 500).after.rungs.get('electricBlue.500')!.hex,
        );
        const grey = detachPreview(baseline, before, 'grey', 1000)!;
        expect(grey.feedsLadder).toBe(false);
        expect(grey.landsAt).toBe('#344563');
    });
});
