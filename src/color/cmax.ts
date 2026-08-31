/**
 * Cmax: the sRGB gamut boundary chroma for a given (L, H).
 *
 * The engine needs the SCALAR boundary, not a clamped colour, because it then
 * applies a factor to it (0.98 for six families, 0.571 for purple) and because
 * a scalar memoises. That is why culori's `clampChroma` does not fit.
 *
 * Bisection, not Ottosson's analytic find_cusp: 12 lines, provably reproduces
 * the shipped palette, and memoises well. Revisit only if profiling says so.
 */

import { inGamut } from './oklab';

/**
 * 15 iterations over a 0.4-wide bracket resolves to 0.4 / 2^15 = 1.2e-5.
 * 8-bit output needs ~1e-4, so 15 is right and 50 is wasted work.
 */
const ITERATIONS = 15;
const C_HI = 0.4;

/** Uncached gamut-boundary chroma at (L, H). */
export function cmaxForUncached(L: number, H: number): number {
    // Achromatic ends have no chroma headroom at all; bisecting there returns
    // ~0 anyway, but short-circuiting avoids 15 pointless matrix multiplies
    // per rung on the near-white and near-black rows.
    if (L <= 0 || L >= 1) return 0;

    let lo = 0;
    let hi = C_HI;

    // If even C_HI is inside the gamut there is nothing to find. Cannot happen
    // in sRGB, but an unbounded bracket would silently return C_HI if it did.
    if (inGamut(L, hi, H)) return hi;

    for (let i = 0; i < ITERATIONS; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(L, mid, H)) lo = mid;
        else hi = mid;
    }
    return lo;
}

/**
 * LRU over quantised (L, H).
 *
 * Key granularity is chosen for drag behaviour: an L-anchor drag holds H
 * constant across the 8 rungs of a family, and a hue drag holds L constant.
 * Either way the hit rate is high. 4096 steps of L is finer than 8-bit output
 * can express; 64 steps per degree likewise.
 */
const CACHE_LIMIT = 8192;
const cache = new Map<number, number>();

export function cmaxFor(L: number, H: number): number {
    // Fold both quantised coordinates into one integer key — a Map<number> is
    // meaningfully faster than a Map<string> at this call volume.
    const lq = Math.round(L * 4096);
    const hq = Math.round((((H % 360) + 360) % 360) * 64);
    const key = lq * 23041 + hq;

    const hit = cache.get(key);
    if (hit !== undefined) {
        // Refresh recency: delete + set moves the entry to the end of Map order.
        cache.delete(key);
        cache.set(key, hit);
        return hit;
    }

    const value = cmaxForUncached(lq / 4096, hq / 64);
    if (cache.size >= CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, value);
    return value;
}
