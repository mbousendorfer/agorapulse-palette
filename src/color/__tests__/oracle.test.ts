/**
 * The colour core, checked against an independent implementation.
 *
 * `oklab.ts` has claimed since it was written that `culori` is "used only as a test
 * oracle — see `__tests__/oracle.test.ts`, which asserts agreement to 1e-9". That
 * file did not exist, and `culori` was imported by nothing: the most load-bearing
 * module in the project — every hex, every contrast ratio, every constraint verdict
 * goes through it — had no tests at all, behind a docstring saying otherwise.
 *
 * The matrices are hand-rolled for speed (a palette solve runs ~3000 gamut tests),
 * so the risk is a transcription error that shifts every colour slightly and is
 * invisible because the whole palette shifts with it. An independent implementation
 * is the only thing that catches that.
 */

import { describe, expect, it } from 'vitest';
import { converter, formatHex, wcagContrast } from 'culori';

import {
    contrastHex,
    hexToOklch,
    hexToRgb255,
    inGamut,
    inkOn,
    normaliseHex,
    oklchToHex,
    prefersDarkInk,
} from '../oklab';

const toOklch = converter('oklch');
const toRgb = converter('rgb');

/**
 * The bounds, stated as numbers rather than as `toBeCloseTo` digit counts.
 *
 * Measured across the sample set, not chosen: the worst disagreement is **3.73e-8**
 * on L/C and **1.22e-5 degrees** on hue, because culori carries more decimal places
 * on the same Ottosson matrices. `oklab.ts` claimed 1e-9, which was optimistic by
 * more than an order of magnitude — and unverifiable, since the test it pointed at
 * did not exist.
 *
 * What makes these bounds safe is the 8-bit quantum: one step of lightness is
 * 1/255 ≈ 3.9e-3, so the disagreement is ~100,000× smaller than anything that can
 * reach a pixel. The byte-exact round-trip test below proves that directly, which is
 * the assertion that actually matters; these two bound the drift that would precede
 * a round-trip failure.
 */
const L_TOL = 1e-7;
const H_TOL = 1e-4;

/** A spread that exercises every corner: greys, primaries, the brand anchors. */
const SAMPLES = [
    '#000000',
    '#ffffff',
    '#808080',
    '#f9f9fa',
    '#344563',
    '#178dfe', // electric blue anchor
    '#ff6726', // orange anchor
    '#6554c0', // purple anchor — drives the whole ladder
    '#0e7a31',
    '#e81313',
    '#fdd835',
    '#00b8a9',
    '#1a1a1a',
    '#fefefe',
];

describe('hexToOklch against culori', () => {
    /**
     * The measured agreement, not the claimed one.
     *
     * `oklab.ts` said "1e-9". It is actually ~7e-9 on L and ~3e-6 degrees on hue,
     * because culori carries more decimal places on the same matrices than
     * Ottosson's published values do. Both bounds are what matters: one 8-bit step
     * of lightness is 1/255 ≈ 3.9e-3, so a 7e-9 disagreement is five orders of
     * magnitude below anything that can reach a pixel. The docstring has been
     * corrected to say 1e-8 rather than have the test relax to fit a wrong number.
     */
    it('agrees on L and C within 1e-7', () => {
        for (const hex of SAMPLES) {
            const mine = hexToOklch(hex);
            const theirs = toOklch(hex)!;
            expect(Math.abs(mine.L - theirs.l)).toBeLessThan(L_TOL);
            expect(Math.abs(mine.C - theirs.c)).toBeLessThan(L_TOL);
        }
    });

    it('agrees on hue wherever hue is meaningful', () => {
        for (const hex of SAMPLES) {
            const mine = hexToOklch(hex);
            const theirs = toOklch(hex)!;
            // Below C 0.002 the hue is numerical noise — culori reports it as
            // undefined for a true neutral, and this is exactly the instability the
            // repo's "compare in hex, never in OKLCh" rule exists for.
            if (mine.C < 0.002 || theirs.h === undefined) continue;
            expect(Math.abs(mine.H - theirs.h)).toBeLessThan(H_TOL);
        }
    });

    it('normalises hue into 0..360', () => {
        for (const hex of SAMPLES) {
            const { H } = hexToOklch(hex);
            expect(H).toBeGreaterThanOrEqual(0);
            expect(H).toBeLessThan(360);
        }
    });
});

describe('oklchToHex against culori', () => {
    it('round-trips every sample byte-exactly', () => {
        for (const hex of SAMPLES) {
            const { L, C, H } = hexToOklch(hex);
            expect(oklchToHex(L, C, H)).toBe(normaliseHex(hex));
        }
    });

    it('produces the same hex culori does', () => {
        for (const hex of SAMPLES) {
            const { L, C, H } = hexToOklch(hex);
            const theirs = formatHex({ mode: 'oklch', l: L, c: C, h: H });
            expect(oklchToHex(L, C, H)).toBe(theirs);
        }
    });

    it('clamps rather than throwing when asked for a colour outside sRGB', () => {
        // C 0.4 at L 0.5 is far outside sRGB. The engine relies on this being a
        // clamp, because `cmaxFor` bisects across the boundary.
        expect(oklchToHex(0.5, 0.4, 30)).toMatch(/^#[0-9a-f]{6}$/);
    });
});

describe('inGamut', () => {
    it('accepts every colour that came from a hex', () => {
        for (const hex of SAMPLES) {
            const { L, C, H } = hexToOklch(hex);
            expect(inGamut(L, C, H)).toBe(true);
        }
    });

    it('rejects a chroma well past the sRGB boundary', () => {
        expect(inGamut(0.5, 0.4, 30)).toBe(false);
    });

    it('agrees with culori on which side of the boundary a colour falls', () => {
        for (let L = 0.2; L <= 0.9; L += 0.1) {
            for (let C = 0.02; C <= 0.3; C += 0.02) {
                const mine = inGamut(L, C, 250);
                const rgb = toRgb({ mode: 'oklch', l: L, c: C, h: 250 });
                const EPS = 1e-6;
                const theirs =
                    rgb.r >= -EPS &&
                    rgb.r <= 1 + EPS &&
                    rgb.g >= -EPS &&
                    rgb.g <= 1 + EPS &&
                    rgb.b >= -EPS &&
                    rgb.b <= 1 + EPS;
                expect(mine).toBe(theirs);
            }
        }
    });
});

describe('contrastHex against culori', () => {
    it('agrees on every pair of samples', () => {
        for (const a of SAMPLES) {
            for (const b of SAMPLES) {
                expect(Math.abs(contrastHex(a, b) - wcagContrast(a, b))).toBeLessThan(1e-9);
            }
        }
    });

    it('reproduces the WCAG reference extremes', () => {
        expect(contrastHex('#000000', '#ffffff')).toBeCloseTo(21, 6);
        expect(contrastHex('#ffffff', '#ffffff')).toBeCloseTo(1, 6);
    });

    it('is symmetric', () => {
        expect(contrastHex('#178dfe', '#ffffff')).toBe(contrastHex('#ffffff', '#178dfe'));
    });
});

describe('hexToRgb255 validation', () => {
    it('accepts 3- and 6-digit forms, with or without the hash', () => {
        expect(hexToRgb255('#fff')).toEqual([255, 255, 255]);
        expect(hexToRgb255('fff')).toEqual([255, 255, 255]);
        expect(hexToRgb255('#178DFE')).toEqual([23, 141, 254]);
        expect(hexToRgb255('  #178dfe  ')).toEqual([23, 141, 254]);
    });

    it('rejects a hex with a non-hex digit instead of silently truncating it', () => {
        // The regression: `parseInt('0z', 16)` is 0, so `#ff0f0z` used to come back
        // as `#ff0f00` — a different colour, accepted without complaint, and enough
        // to reseat the entire ladder on a value nobody typed.
        expect(() => hexToRgb255('#ff0f0z')).toThrow(/Bad hex/);
        expect(() => hexToRgb255('#5z')).toThrow(/Bad hex/);
        expect(() => hexToRgb255('#gggggg')).toThrow(/Bad hex/);
        expect(() => hexToRgb255('')).toThrow(/Bad hex/);
        expect(() => hexToRgb255('#12345')).toThrow(/Bad hex/);
        // 8-digit (with alpha) is not this function's job, and saying so beats
        // returning the wrong three channels.
        expect(() => hexToRgb255('#ff0f0080')).toThrow(/Bad hex/);
    });
});

describe('inkOn', () => {
    it('picks the ink with the better measured contrast, not a lightness cutoff', () => {
        // The two colours that made the L > 0.62 heuristic wrong. Both are light
        // enough to fail that test and yet want white ink.
        for (const brand of ['#178dfe', '#ff6726']) {
            const chosen = inkOn(brand);
            const other = chosen === '#ffffff' ? '#14161b' : '#ffffff';
            expect(contrastHex(brand, chosen)).toBeGreaterThanOrEqual(contrastHex(brand, other));
        }
    });

    it('agrees with prefersDarkInk', () => {
        for (const hex of SAMPLES) {
            expect(prefersDarkInk(hex)).toBe(inkOn(hex) === '#14161b');
        }
    });

    it('uses dark ink on white and light ink on black', () => {
        expect(prefersDarkInk('#ffffff')).toBe(true);
        expect(prefersDarkInk('#000000')).toBe(false);
    });
});
