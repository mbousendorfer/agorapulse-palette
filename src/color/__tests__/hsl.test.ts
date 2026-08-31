/**
 * What HSL has to get right for the notation switch to be safe.
 *
 * The risk is not the maths — it is the LOSS. Rounded to the integers a designer types, HSL
 * cannot name every hex, so a switch to HSL and back must not be able to write a value. These
 * tests pin the loss so the inspector's decision to HOLD the triple in state — rather than
 * re-deriving it from the hex on every frame — has a measured reason rather than a cautious one.
 */

import { describe, expect, it } from 'vitest';

import { hexToHsl, hslToHex } from '../hsl';
import { hexToRgb255 } from '../oklab';

describe('hexToHsl', () => {
    it('places the primaries where CSS does', () => {
        expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 100, l: 50 });
        expect(hexToHsl('#00ff00')).toEqual({ h: 120, s: 100, l: 50 });
        expect(hexToHsl('#0000ff')).toEqual({ h: 240, s: 100, l: 50 });
    });

    it('reports grey as zero saturation, whatever the hue would have been', () => {
        expect(hexToHsl('#808080')).toEqual({ h: 0, s: 0, l: 50 });
        expect(hexToHsl('#ffffff')).toEqual({ h: 0, s: 0, l: 100 });
        expect(hexToHsl('#000000')).toEqual({ h: 0, s: 0, l: 0 });
    });
});

describe('hslToHex', () => {
    it('wraps hue and clamps the two percentages', () => {
        expect(hslToHex({ h: 360, s: 100, l: 50 })).toBe(hslToHex({ h: 0, s: 100, l: 50 }));
        expect(hslToHex({ h: -120, s: 100, l: 50 })).toBe(hslToHex({ h: 240, s: 100, l: 50 }));
        expect(hslToHex({ h: 0, s: 400, l: 400 })).toBe('#ffffff');
    });
});

describe('the round trip', () => {
    /*
       Every shade in the shipped palette, through HSL and back. The assertion is NOT equality:
       integer HSL has ~3.6 million representable colours against sRGB's 16.7 million, so a
       round trip lands nearby rather than home. What matters is HOW nearby — a couple of levels
       per channel is a rounding artefact, a large jump would mean the maths is wrong.
    */
    const SAMPLES = [
        '#f9f9fa',
        '#edeff2',
        '#dfe3e8',
        '#c0c8d1',
        '#a6b1be',
        '#8d9aab',
        '#758499',
        '#5e6e86',
        '#495975',
        '#344563',
        '#178dfe',
        '#ff6726',
        '#6554c0',
        '#0d9930',
        '#ec1011',
        '#c18a0e',
        '#11aba6',
        '#ada8f2',
        '#91e1dc',
        '#fff5f4',
    ];

    it('lands within 3 levels per channel on all 20 samples', () => {
        const worst = SAMPLES.map((hex) => {
            const back = hslToHex(hexToHsl(hex));
            const a = hexToRgb255(hex);
            const b = hexToRgb255(back);
            return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
        });
        expect(Math.max(...worst)).toBeLessThanOrEqual(3);
    });

    it('is NOT injective, which is why switching notation must not commit', () => {
        /*
           Two distinct hexes that share one integer HSL string, found by sweeping a slice of
           sRGB rather than guessed — the first pair written here differed by a degree and the
           test caught it.

           This is the measured reason the inspector only commits text the user typed. If it
           ever became a single colour, that rule could be relaxed; it has not.
        */
        expect(hexToHsl('#64a0e6')).toEqual({ h: 212, s: 72, l: 65 });
        expect(hexToHsl('#64a1e6')).toEqual({ h: 212, s: 72, l: 65 });
        expect('#64a0e6').not.toBe('#64a1e6');
    });
});
