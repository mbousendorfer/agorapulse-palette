/**
 * Monotone bisection with a guard.
 *
 * Every numeric solve in this engine is a bisection on a residual that is
 * monotone over the bracket. The guard matters: WCAG contrast is monotone in L
 * only on one side of the crossover, and a silently-wrong bisection on the
 * rung-200 solve would corrupt the entire ladder without any obvious symptom.
 * So we check the residual's sign at both ends and refuse if they agree.
 */

export interface BisectResult {
    x: number;
    /** Residual at the returned x. */
    residual: number;
    iterations: number;
}

export class NotBracketed extends Error {
    constructor(
        readonly lo: number,
        readonly hi: number,
        readonly fLo: number,
        readonly fHi: number,
        label: string,
    ) {
        super(
            `${label}: residual does not change sign over [${lo}, ${hi}] ` +
                `(f(lo)=${fLo.toFixed(6)}, f(hi)=${fHi.toFixed(6)}). ` +
                `Refusing to bisect — the target is unreachable in this bracket.`,
        );
        this.name = 'NotBracketed';
    }
}

export class NotFinite extends Error {
    constructor(lo: number, hi: number, fLo: number, fHi: number, label: string) {
        super(
            `${label}: residual is not a finite number over [${lo}, ${hi}] ` +
                `(f(lo)=${fLo}, f(hi)=${fHi}). Refusing to bisect.`,
        );
        this.name = 'NotFinite';
    }
}

/**
 * Why there is no early exit on bracket width — this was tried and measured.
 *
 * The reasoning looked airtight: every residual here is a function of an 8-bit
 * hex, so it is a staircase; one LSB of lightness is ~1/255 ≈ 3.9e-3; a bracket
 * narrower than that cannot distinguish two answers; so stopping at 1e-5 should be
 * exact and would cut the 40 halvings to ~16. `worst()` costs 7 families × 2
 * `cmaxFor` calls × ~15 gamut tests, so that read as thousands of wasted tests per
 * solve.
 *
 * It is wrong, and the fidelity harness caught it. Because the residual is a
 * staircase, bisection converges onto the BOUNDARY between two plateaus, and
 * stopping 1e-5 short can leave `mid` on the far side of it. Measured against the
 * shipped palette: byte-exact rungs fell from 57 to 54, and C6 — contrast(grey 800,
 * grey 200) ≥ 4.5 — went from binding to **violated at −0.047**. The extra
 * halvings are not refining digits nobody can see; they are what pins the answer to
 * the correct step of the staircase.
 *
 * And the premise was false anyway: a full solve is 2.7 ms. There was nothing to
 * buy. Do not reintroduce this without running `npm run fidelity`.
 *
 * The one guard that IS free is the finiteness check below.
 */

/**
 * Find x in [lo, hi] where `residual(x) === 0`.
 * `residual` must be monotone and change sign across the bracket.
 */
export function bisect(
    residual: (x: number) => number,
    lo: number,
    hi: number,
    label: string,
    iterations = 40,
): BisectResult {
    const fLo = residual(lo);
    const fHi = residual(hi);

    // Before the sign check, because `Math.sign(NaN)` is `NaN` and `NaN === NaN`
    // is false — so a residual that was NaN at BOTH ends sailed through the
    // bracket guard, took the same branch on all 40 iterations, and returned
    // `x ≈ lo` with `residual: NaN`. That is precisely the silently-wrong
    // bisection this module's guard exists to make impossible.
    if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) {
        throw new NotFinite(lo, hi, fLo, fHi, label);
    }

    if (fLo === 0) return { x: lo, residual: 0, iterations: 0 };
    if (fHi === 0) return { x: hi, residual: 0, iterations: 0 };
    if (Math.sign(fLo) === Math.sign(fHi)) {
        throw new NotBracketed(lo, hi, fLo, fHi, label);
    }

    let a = lo;
    let b = hi;
    let fa = fLo;
    let mid = (a + b) / 2;
    let fMid = residual(mid);

    for (let i = 0; i < iterations; i++) {
        mid = (a + b) / 2;
        fMid = residual(mid);
        if (fMid === 0) return { x: mid, residual: 0, iterations: i + 1 };
        if (Math.sign(fMid) === Math.sign(fa)) {
            a = mid;
            fa = fMid;
        } else {
            b = mid;
        }
    }

    return { x: mid, residual: fMid, iterations };
}
