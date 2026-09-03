/**
 * The authored truth of the palette.
 *
 * Everything here is either an anchor (a hex somebody decided), a free
 * parameter (a number somebody chose), a constraint target, or a declared
 * off-ladder override. The 66 shipped hexes are derived from this and nothing
 * else — that is what `npm run verify` proves.
 */

import type { Scope } from './scope';

export const CHROMATIC_RUNGS = [100, 200, 300, 400, 500, 600, 700, 800] as const;
export const GREY_RUNGS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000] as const;

export type ChromaticRung = (typeof CHROMATIC_RUNGS)[number];
export type GreyRung = (typeof GREY_RUNGS)[number];

/** Style Dictionary key, e.g. `electricBlue`. Kebab happens at CSS-name time. */
export type FamilyId = string;

/** `electricBlue.500`, `grey.1000` — the id an override or anchor addresses. */
export type RungRef = string;

export function rungRef(family: FamilyId, rung: number): RungRef {
    return `${family}.${rung}`;
}

/**
 * What the shared ladder reads a lightness from: an anchor, or a number.
 *
 * The number form is what an UNHOOKED anchor leaves behind. Unhooking `purple.700` turns
 * "rung 700 is the lightness of #6554C0" into "rung 700 is L 0.5197" — the same float the
 * solver was already reading, now written down as a chosen value rather than read off a hex.
 * That is what lets the anchor go without the ladder moving under every other family.
 */
export type LadderSource = RungRef | { L: number };

export function isRungRef(source: LadderSource): source is RungRef {
    return typeof source === 'string';
}

/**
 * One end of the grey scale: a pinned hex, or the lightness and chroma it was pinned at.
 *
 * Both L and C, because grey's chroma is a ramp between its two ends' own chroma — freezing
 * L alone would leave the ramp with nothing to read. Hue is not frozen: at C 0.001 the
 * measured hue of a light grey is 8-bit noise, and the ramp's `hue200`/`hue1000` already
 * carry the intended one.
 */
export type GreyEnd = string | { L: number; C: number };

export function isGreyHex(end: GreyEnd): end is string {
    return typeof end === 'string';
}

export interface FamilySpec {
    id: FamilyId;
    /** Display name for the UI. */
    label: string;
    /** Constant across every rung — the V3 palette has no hue ramp. */
    hue: number;
    /**
     * Fraction of the sRGB gamut boundary the dark end (500-800) sits at.
     * `null` means "use the global factor". Purple is the only family that
     * overrides it, and its value is DERIVED from the #6554c0 anchor rather
     * than chosen — see `deriveChromaFactor`. Until that anchor is unhooked:
     * then the derived value is written here, so the family keeps the chroma
     * the anchor gave it after the anchor itself is gone.
     */
    chromaFactor: number | null;
    /**
     * Rungs pinned to an exact hex. An anchor differs from an override: it
     * pins its own value AND feeds the derivation (the two brand 500s set the
     * ladder's 500; purple's 700 sets the whole ladder).
     *
     * Keyed by plain number rather than the default rung tuple: the ladder can
     * be extended at the dark end, so the set of valid rungs is data, not a
     * fixed literal union.
     */
    anchors: Partial<Record<number, string>>;
    /**
     * What the colour is for: brand design, product design, or both. A declaration the
     * solver never reads — see `scope.ts`. Absent means nothing has been declared.
     */
    scope?: Scope[];
    /**
     * Rungs this family materialises past 800, at the ladder's own low step.
     *
     * PER FAMILY, not global. The shared ladder still defines the lightness of
     * rung 900 for everyone — whether a family has a token AT that rung is a
     * separate question, and grey already answers it differently (10 rungs to the
     * chromatic 8). So this generalises an asymmetry the spec already had rather
     * than introducing one, and a rung number keeps meaning one lightness
     * everywhere, which is the property that matters.
     */
    extraDarkRungs?: number;
}

export interface ChromaticSpec {
    families: FamilySpec[];
    /**
     * What defines the 500 rung. Its L is the mean of the two, so both brand
     * anchors sit OFF the shared ladder — by -0.0271 and +0.0272 respectively.
     * Either entry may be a frozen lightness once its anchor is unhooked.
     */
    rung500From: [LadderSource, LadderSource];
    /**
     * What fixes rung 700, and with it the whole low plateau: the purple anchor
     * as shipped, or the lightness it left behind when unhooked.
     */
    rung700From: LadderSource;
    /**
     * Free parameter: the 100->200 step. Its stated objective (match
     * grey-100's contrast on white) leaves a residual of ~+0.014 — it is a
     * knob with a target, not a derivation. The UI must say so.
     */
    step100: number;
    /** How many steps the 500->700 interval is cut into. 2 today. */
    lowPlateauDivisor: number;
    /** How many steps the 200->500 interval is cut into. 3 today. */
    highPlateauDivisor: number;
    /** Minimum contrast of rung 700 on rung 200, across ALL families. */
    contrast700on200: number;
    /** Global fraction of the gamut boundary for the dark end. */
    chromaFactor: number;
    /**
     * Extra rungs appended to the DARK end, continuing the low plateau at its
     * own step. Named 900, 1000, and so on.
     *
     * The dark end is the only place a rung can be added. Inserting one between
     * 500 and 700 lifts rung 700 to L 0.5702, where green-700 on green-200
     * falls to 3.66 — and that interval is exactly where intermediate
     * hover/active states would want to go, so it is the one addition the
     * constraints forbid. The UI states that rather than hiding the control.
     */
    extraDarkRungs?: number;
    /**
     * Shared ABSOLUTE chroma ceiling for rungs 100-400, in OKLCh C units.
     * Absolute and not proportional on purpose: proportional penalises hues
     * whose 500 is narrow and turns yellow into tan.
     */
    lightEnvelope: [number, number, number, number];
}

export interface GreySpec {
    /** Lightest rung: a pinned hex, or the L and C it was pinned at once unhooked. */
    anchor100: GreyEnd;
    /** Darkest rung, likewise. */
    anchor1000: GreyEnd;
    /** Free parameter: the 100->200 step. */
    step100: number;
    /** Minimum contrast of rung 800 on rung 200. Binding at 4.501 today. */
    contrast800on200: number;
    /** Chroma is linear in L between the two anchors' own chroma. */
    /** Hue is linear in L between these two, from rung 200 to rung 1000. */
    hue200: number;
    hue1000: number;
    /** Same declaration as `FamilySpec.scope`; grey is a colour too. */
    scope?: Scope[];
}

export interface OverrideSpec {
    rung: RungRef;
    hex: string;
    /** Why this rung left the ladder. Shown verbatim in the UI. */
    reason: string;
}

export interface PaletteSpec {
    version: 1;
    chromatic: ChromaticSpec;
    grey: GreySpec;
    /** Declared departures from the derivation. Stored as hex, never as dL*. */
    overrides: OverrideSpec[];
}

/** What the solver produces for one rung. */
export interface SolvedRung {
    family: FamilyId;
    rung: number;
    hex: string;
    /** Continuous values BEFORE 8-bit quantisation. Display with care. */
    L: number;
    C: number;
    H: number;
    provenance: Provenance;
}

/**
 * Which of the competing terms actually set a rung's chroma.
 *
 * `gamutLimited` alone cannot answer this, and the difference is the whole point of
 * a chroma view: it says which knob has stopped having an effect on this rung.
 *
 *   `envelope`  the shared absolute ceiling `lightEnvelope[i]` won (rungs 100-400)
 *   `c500`      the family's own C500 cap won, so a tint cannot out-saturate its
 *               own brand rung. menthol-400 is the live case — and it reports
 *               `gamutLimited: false` while the envelope slider is just as inert
 *               on it, which is exactly the confusion this field removes.
 *   `gamut`     the sRGB boundary won
 *   `factor`    the gamut fraction won (rungs 500+, the normal case)
 *   `ramp`      grey, whose chroma is a linear interpolation between its two
 *               anchors' own chroma rather than a ceiling at all
 */
export type ChromaLimit = 'envelope' | 'c500' | 'gamut' | 'factor' | 'ramp';

export type Provenance =
    /** Derived. `gamutLimited` means chroma hit the sRGB boundary before the
     *  envelope or the factor did — worth surfacing, since it means the knob
     *  the designer is turning has stopped having an effect on this rung.
     *
     *  Note it is NOT a full answer on the dark end: there `gamutLimited` is
     *  literally `factor >= 1`, so at the shipped 0.98 it is false for every dark
     *  rung of every family regardless of hue. `chromaLimit` is the honest one. */
    | { kind: 'ladder'; gamutLimited: boolean; chromaLimit: ChromaLimit }
    /** Pinned hex that also feeds the derivation. */
    | { kind: 'anchor' }
    /** Pinned hex that pins only itself. `deltaL` is signed, vs the ladder. */
    | { kind: 'override'; reason: string; deltaL: number; stepFraction: number };

export interface PaletteSolution {
    /** Keyed by `family.rung`. */
    rungs: Map<RungRef, SolvedRung>;
    /** The chromatic rung names actually solved, e.g. [100..800] or [100..1000]. */
    chromaticRungs: number[];
    /** The shared chromatic L values, parallel to `chromaticRungs`. */
    chromaticLadder: number[];
    /** The 10 grey L values, rungs 100..1000. */
    greyLadder: number[];
    /** Derived intermediates worth showing in the Engine panel. */
    derived: {
        L500: number;
        L700: number;
        lowStep: number;
        highStep: number;
        /** L of rung 200, SOLVED by the contrast constraint, not chosen. */
        L200: number;
        /** Which family bound the rung-200 solve. */
        rung200Witness: FamilyId;
        greyStep1: number;
        greyStep2: number;
        greyStep3: number;
        greyTailStep: number;
        /** purple's gamut fraction, back-solved from its anchor. */
        purpleChromaFactor: number;
        /**
         * Where the two seated rungs read their lightness from, as words: `purple.700`, or
         * `chosen L 0.5197` once that anchor is unhooked. Produced HERE so the engine panel,
         * the markdown export and the fidelity report print one sentence rather than each
         * hard-coding "the purple anchor" and going stale the moment it is gone.
         */
        ladderSources: { L700: string; L500: [string, string] };
    };
}

export function getRung(sol: PaletteSolution, family: FamilyId, rung: number): SolvedRung {
    const r = sol.rungs.get(rungRef(family, rung));
    if (!r) throw new Error(`No solved rung ${family}.${rung}`);
    return r;
}
