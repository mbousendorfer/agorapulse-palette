/**
 * What the anchors panel is allowed to claim.
 *
 * These pin the numbers the UI prints beside each anchor. If the spec or the solver changes,
 * this fails and names the anchor whose reach moved — which is the point: the figure it replaces
 * was prose, and prose does not fail.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { anchorKeys, anchorReach } from '../reach';
import { solvePalette } from '../solve';
import type { PaletteSpec } from '../types';

const spec = JSON.parse(readFileSync('spec/palette.baseline.json', 'utf8')) as PaletteSpec;
const reach = anchorReach(spec);
const total = solvePalette(spec).rungs.size;

describe('anchorReach', () => {
    it('answers for every anchor and nothing else', () => {
        expect([...reach.keys()].sort()).toEqual(anchorKeys(spec).sort());
        expect(reach.size).toBe(5);
    });

    it('never claims more than the palette has', () => {
        for (const [key, n] of reach) {
            if (n === null) continue;
            expect(n, key).toBeGreaterThan(0);
            expect(n, key).toBeLessThanOrEqual(total);
        }
    });

    /*
       The pinned values, and the shape of them is the finding.

       The prose these replace said the three brand anchors reach "35, 37 and 49". Measured, they
       are 33, 35 and 49 — so the sentence had already drifted from the spec it described, which
       is the whole argument for computing it.

       The two grey numbers are the interesting ones, and they are why the UI must not say
       "reaches". Grey 100 and grey 1000 STRUCTURALLY seed all ten grey rungs — every one of them
       is derived from those two — yet a 0.01 nudge moves only 8 and 3 hexes. Rungs 300 to 700
       are distributed by solving a geometric mean, so a small push at one end is divided among
       them and most land inside the same 8-bit value. This measures what you will SEE move, not
       what depends on what.
    */
    it('reproduces the measured sensitivity of each anchor', () => {
        expect(Object.fromEntries(reach)).toEqual({
            'electricBlue.500': 33,
            'orange.500': 35,
            'purple.700': 49,
            'grey.100': 8,
            'grey.1000': 3,
        });
    });

    it('separates the two ladders, which is the structural claim worth guarding', () => {
        // Grey is an independent scale: neither grey anchor may move a chromatic rung, and no
        // brand anchor may move a grey one. A number above 10 for grey, or above 56 for a brand
        // anchor, would mean the two ladders had become coupled.
        expect(reach.get('grey.100')!).toBeLessThanOrEqual(10);
        expect(reach.get('grey.1000')!).toBeLessThanOrEqual(10);
        expect(reach.get('purple.700')!).toBeLessThanOrEqual(total - 10);
    });
});
