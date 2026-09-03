/**
 * How the palette is built — drawn, not described.
 *
 * This fold used to be five input rows and a numbered list of six equations. Everything in it
 * was true and almost none of it could be SEEN: "rung 500 ← mean of the electricBlue.500
 * anchor's lightness and the orange.500 anchor's lightness · 0.6711" is a sentence about a
 * position, read by somebody who has a screen in front of them that could simply show the
 * position.
 *
 * Two pictures now, in the order the derivation runs:
 *
 *   1. THE ANCHORS, as cards. A swatch you can open, the hex you can type, and — the part the
 *      rows never said — the anchor's ROLE in one line: "seats rung 700, the whole ladder hangs
 *      from it", "half of rung 500, averaged with Orange 500", "light end of the grey scale".
 *      Under it the measured reach, and the way to let it go.
 *
 *   2. THE LADDER, as a ladder. One lightness axis, light on the left and dark on the right like
 *      the wall above, and every rung drawn AT ITS LIGHTNESS — so a plateau is visibly a plateau,
 *      the 500→700 interval is visibly the one that is halved, and the two brand anchors visibly
 *      sit either side of the 500 they average to. Each rung carries the one word that says how
 *      it got there: anchor, mean, solved, ÷2, ÷3, +step. Grey draws its own scale underneath,
 *      on the same axis, so its degressive light end and even tail can be compared to the
 *      chromatic one by eye. A legend defines the six words once.
 *
 * Every figure is still computed: reach by re-solving (`engine/reach.ts`), positions from the
 * solution, roles from the spec's own `rung700From` / `rung500From`. Nothing here is a caption
 * that can go stale when an anchor is unhooked or a rung is added.
 */

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Chip } from './Chip';

import { hexToOklch, normaliseHex } from '../color/oklab';
import { countAnchors, detachAnchor, detachGreyAnchor } from '../engine/anchors';
import { evaluateConstraints } from '../engine/constraints';
import { greyEnd } from '../engine/grey';
import { anchorReach } from '../engine/reach';
import {
    isGreyHex,
    isRungRef,
    rungRef,
    type PaletteSolution,
    type PaletteSpec,
} from '../engine/types';
import { useResetOn } from './useDerived';
import { paletteEditCount, useStore } from '../state/store';

export function EngineRules() {
    const spec = useStore((s) => s.spec);
    const solution = useStore((s) => s.solution);
    const updateSpec = useStore((s) => s.updateSpec);
    const say = useStore((s) => s.say);

    /*
       Ten solves, memoised on the spec.

       `anchorReach` nudges each anchor both ways and re-solves — 3.3 ms a solve, so ~33 ms when
       the spec changes and nothing while it does not. Affordable HERE and nowhere near the wall:
       this fold is closed by default and re-renders on a committed edit, not on a pointer move.
    */
    const reach = useMemo(() => anchorReach(spec), [spec]);
    const anchorCount = countAnchors(spec);

    // Memoised: ~30 contrastHex calls, and the panel re-renders on every palette edit.
    const constraints = useMemo(() => evaluateConstraints(spec, solution), [spec, solution]);
    const violated = constraints.filter((c) => c.status === 'violated');
    const binding = constraints.filter((c) => c.status === 'binding');

    /*
       Folded by default, and plain `useState`. Folded is the right default on its own terms:
       the palette above is the subject.
    */
    const [open, setOpen] = useState(false);

    /**
     * What an anchor DOES, in one line, read off the spec rather than assumed. The wording is
     * the derivation's own: a rung is seated, halved, or pinned.
     */
    const roleOf = (family: string, rung: number): string => {
        const ref = rungRef(family, rung);
        const c = spec.chromatic;
        if (isRungRef(c.rung700From) && c.rung700From === ref) {
            return 'Seats rung 700. The whole ladder hangs from this lightness.';
        }
        const at = c.rung500From.findIndex((s) => isRungRef(s) && s === ref);
        if (at >= 0) {
            const other = c.rung500From[at === 0 ? 1 : 0];
            const otherName = isRungRef(other)
                ? (() => {
                      const [fam, r] = other.split('.');
                      return `${c.families.find((f) => f.id === fam)?.label ?? fam} ${r}`;
                  })()
                : `a chosen lightness of ${other.L.toFixed(4)}`;
            return `Half of rung 500 — averaged with ${otherName}. Neither sits on the ladder itself.`;
        }
        return 'Pins its own shade. The ladder does not read it.';
    };

    return (
        <details
            className="fold [&>summary]:border-t [&>summary]:text-sm [&>summary]:font-bold [&>summary_em]:text-xs [&>summary_em]:font-normal [&>summary_em]:text-muted-foreground [&>summary_em]:not-italic"
            open={open}
            onToggle={(e) => setOpen(e.currentTarget.open)}
        >
            <summary>
                How this palette is built
                <em>
                    {violated.length
                        ? `${violated.length} rule broken`
                        : `${spec.chromatic.families.length} hues on one ladder · ${spec.overrides.length} shades held off it`}
                </em>
            </summary>
            {/* No Card inside the fold: the fold's own rule is the section boundary. The two
                pictures below are separated by space and a heading, not by boxes. */}
            <div className="fold-body eng">
                {/* ------------------------------------------------ 1. the anchors ---- */}
                <section className="eng-sec">
                    <header className="eng-head">
                        {/* Counted, like every figure on this page: "five" would be wrong the
                            moment one is unhooked. */}
                        <h3 className="text-foreground text-sm font-semibold">
                            {anchorCount === 0
                                ? 'No anchors'
                                : `${anchorCount === 1 ? 'One' : anchorCount} anchor${anchorCount === 1 ? '' : 's'}`}
                        </h3>
                        <p className="text-muted-foreground text-xs">
                            {anchorCount === 0
                                ? `Every anchor has been unhooked. The ladder is seated on the lightnesses they left behind, and all ${solution.rungs.size} shades are derived.`
                                : `Hexes somebody decided. Every other shade is solved from these — "moves" is how many of the ${solution.rungs.size} shades change hex when the anchor's lightness moves by 0.01, measured by re-solving.`}
                        </p>
                    </header>
                    <div className="anchor-cards">
                        {spec.chromatic.families
                            .filter((f) => Object.keys(f.anchors).length > 0)
                            .map((family) =>
                                Object.entries(family.anchors).map(([rung, hex]) => (
                                    <AnchorCard
                                        key={`${family.id}.${rung}`}
                                        label={`${family.label} ${rung}`}
                                        hex={hex as string}
                                        role={roleOf(family.id, Number(rung))}
                                        moves={reach.get(`${family.id}.${rung}`)}
                                        onChange={(next) =>
                                            updateSpec((draft) => {
                                                const f = draft.chromatic.families.find(
                                                    (x) => x.id === family.id,
                                                );
                                                if (f) f.anchors[Number(rung)] = next;
                                            })
                                        }
                                        onUnhook={() => {
                                            updateSpec((draft) =>
                                                detachAnchor(draft, family.id, Number(rung)),
                                            );
                                            say(
                                                `${family.label} ${rung} unhooked — derived now; the ladder kept its lightness`,
                                            );
                                        }}
                                    />
                                )),
                            )}
                        {([100, 1000] as const).map((rung) => {
                            const key = rung === 100 ? 'anchor100' : 'anchor1000';
                            const end = spec.grey[key];
                            const role =
                                rung === 100
                                    ? 'Light end of the grey scale. Grey has no hue; its two ends set its lightness and its chroma.'
                                    : 'Dark end of the grey scale. Rung 800 is solved between the two ends for 4.5 on the 200.';
                            return isGreyHex(end) ? (
                                <AnchorCard
                                    key={`grey.${rung}`}
                                    label={`Grey ${rung}`}
                                    hex={end}
                                    role={role}
                                    moves={reach.get(`grey.${rung}`)}
                                    onChange={(next) =>
                                        updateSpec((x) => void (x.grey[key] = next))
                                    }
                                    onUnhook={() => {
                                        updateSpec((draft) => detachGreyAnchor(draft, rung));
                                        say(`grey ${rung} unhooked — derived now`);
                                    }}
                                />
                            ) : (
                                <UnhookedCard
                                    key={`grey.${rung}`}
                                    label={`Grey ${rung}`}
                                    role={role}
                                    end={greyEnd(end)}
                                />
                            );
                        })}
                    </div>
                </section>

                {/* ------------------------------------------------- 2. the ladder ---- */}
                <section className="eng-sec">
                    <header className="eng-head">
                        <h3 className="text-foreground text-sm font-semibold">
                            The ladder they seat
                        </h3>
                        <p className="text-muted-foreground text-xs">
                            A rung is a lightness. Drawn at true position, lighter on the left like
                            the wall — so the plateaus, the halved interval and the two brand
                            anchors either side of their mean can be read off rather than worked
                            out. The word under each rung is how it got there.
                        </p>
                    </header>
                    <LadderFigure spec={spec} solution={solution} />
                </section>

                {/* ------------------------------------------------- 3. the rules ----- */}
                <footer className="eng-foot">
                    {/*
                       One line, not a third copy of the table. `Rules & audit` lists all seven
                       with signed slack and named witnesses; the bezel carries the same count.
                       What this adds is immediacy: nudge an anchor and know here whether you
                       broke something.
                    */}
                    <p className="text-xs">
                        {violated.length ? (
                            <span className="text-destructive">
                                {violated.length} of {constraints.length} rules broken —{' '}
                                {violated.map((c) => c.id).join(', ')}
                            </span>
                        ) : (
                            <span className="text-muted-foreground">
                                All {constraints.length} rules hold
                                {binding.length > 0 && (
                                    <>
                                        {' · '}
                                        <span className="text-foreground font-medium">
                                            {binding.length} with no slack
                                        </span>
                                    </>
                                )}
                            </span>
                        )}
                        <span className="text-muted-foreground">
                            {' '}
                            · the slack and the witness for each are on Rules &amp; audit
                        </span>
                    </p>
                    {/* Reachable whenever the panel is open — the one destructive control on
                        the page, so it sits at the bottom of the fold rather than beside the
                        wall. */}
                    <ResetEverything />
                </footer>
            </div>
        </details>
    );
}

// ------------------------------------------------------------------ the ladder ----

/** The one word that says how a chromatic rung got its lightness, by position on the ladder. */
function chromaticTag(i: number, spec: PaletteSpec): string {
    switch (i) {
        case 0:
            return '+step';
        case 1:
            return 'solved';
        case 2:
        case 3:
            return `÷${spec.chromatic.highPlateauDivisor}`;
        case 4:
            return 'mean';
        case 6:
            return isRungRef(spec.chromatic.rung700From) ? 'anchor' : 'chosen';
        default:
            return `÷${spec.chromatic.lowPlateauDivisor}`;
    }
}

/** Likewise for grey, whose ten rungs have their own derivation. */
function greyTag(i: number, spec: PaletteSpec): string {
    if (i === 0) return isGreyHex(spec.grey.anchor100) ? 'anchor' : 'chosen';
    if (i === 9) return isGreyHex(spec.grey.anchor1000) ? 'anchor' : 'chosen';
    if (i === 1) return '−step';
    if (i === 7) return 'solved';
    if (i === 8) return 'even';
    return 'cadence';
}

/**
 * The lightness ladder, drawn.
 *
 * One axis for both scales, spanning every rung either has, with a little air at each end. A
 * rung is a mark at `pct(L)`; a chromatic mark is filled with the NEUTRAL of its own lightness
 * (`oklch(L 0 0)`), because the shared ladder is a lightness and not a colour — the hue is what
 * each family adds afterwards. A grey mark is filled with the grey itself, which is the same
 * statement made the other way.
 *
 * Above the chromatic rail, a dot per anchor at the anchor's own lightness, joined by a hairline
 * to the rung it feeds: the two brand dots straddle the 500 they average to, and the purple dot
 * sits exactly on 700. That picture IS constraints C1 and C2.
 */
function LadderFigure({ spec, solution }: { spec: PaletteSpec; solution: PaletteSolution }) {
    const { chromaticRungs, chromaticLadder, greyLadder, derived: d } = solution;

    const all = [...chromaticLadder, ...greyLadder];
    const hi = Math.max(...all) + 0.02;
    const lo = Math.min(...all) - 0.02;
    const pct = (L: number) => ((hi - L) / (hi - lo)) * 100;

    /* Every chromatic anchor, with the ladder lightness it feeds — or none, for one that only
       pins its own shade. The link is drawn from the dot to the fed rung. */
    const anchors = spec.chromatic.families.flatMap((f) =>
        Object.entries(f.anchors).map(([rung, hex]) => {
            const ref = rungRef(f.id, Number(rung));
            const c = spec.chromatic;
            const feeds =
                isRungRef(c.rung700From) && c.rung700From === ref
                    ? d.L700
                    : c.rung500From.some((s) => isRungRef(s) && s === ref)
                      ? d.L500
                      : null;
            return {
                label: `${f.label} ${rung}`,
                hex: hex as string,
                L: hexToOklch(hex as string).L,
                feeds,
            };
        }),
    );

    const greyRungs = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const greyHex = (rung: number) => solution.rungs.get(rungRef('grey', rung))?.hex ?? '#888';

    return (
        <div className="ladder">
            <div className="ladder-row">
                <div className="ladder-label text-xs">
                    shared ladder
                    <small className="text-muted-foreground">
                        {spec.chromatic.families.length} hues
                    </small>
                </div>
                <div className="ladder-track">
                    {anchors.map((a) => (
                        <span key={a.label}>
                            {a.feeds !== null && (
                                <span
                                    className="ladder-link"
                                    style={{
                                        left: `${Math.min(pct(a.L), pct(a.feeds))}%`,
                                        width: `${Math.abs(pct(a.L) - pct(a.feeds))}%`,
                                    }}
                                />
                            )}
                            <span
                                className="ladder-dot"
                                style={{ left: `${pct(a.L)}%`, background: a.hex }}
                                title={`${a.label} ${a.hex} — L ${a.L.toFixed(4)}${a.feeds !== null ? `, feeds rung ${a.feeds === d.L700 ? 700 : 500}` : ''}`}
                            />
                        </span>
                    ))}
                    <span className="ladder-rail" />
                    {chromaticRungs.map((rung, i) => {
                        const L = chromaticLadder[i];
                        return (
                            <div
                                key={rung}
                                className="ladder-mark"
                                style={{ left: `${pct(L)}%` }}
                                title={`rung ${rung} — L ${L.toFixed(4)} · ${chromaticTag(i, spec)}`}
                            >
                                <span className="ladder-num">{rung}</span>
                                <span
                                    className="ladder-bar"
                                    style={{ background: `oklch(${L} 0 0)` }}
                                />
                                <span className="ladder-val">{L.toFixed(3)}</span>
                                <span className="ladder-tag">{chromaticTag(i, spec)}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="ladder-row">
                <div className="ladder-label text-xs">
                    grey
                    <small className="text-muted-foreground">its own scale</small>
                </div>
                <div className="ladder-track">
                    <span className="ladder-rail" />
                    {greyRungs.map((rung, i) => {
                        const L = greyLadder[i];
                        return (
                            <div
                                key={rung}
                                className="ladder-mark"
                                style={{ left: `${pct(L)}%` }}
                                title={`grey ${rung} — L ${L.toFixed(4)} · ${greyTag(i, spec)}`}
                            >
                                <span className="ladder-num">{rung}</span>
                                <span
                                    className="ladder-bar"
                                    style={{ background: greyHex(rung) }}
                                />
                                <span className="ladder-val">{L.toFixed(3)}</span>
                                <span className="ladder-tag">{greyTag(i, spec)}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            <p className="ladder-legend text-xs">
                <b>anchor</b> a hex somebody decided · <b>chosen</b> the lightness an unhooked
                anchor left behind · <b>mean</b> midway between the two brand anchors, which is why
                neither sits on the ladder · <b>solved</b> the lightest value that keeps 700 on 200
                at {spec.chromatic.contrast700on200} — {d.rung200Witness} binds it · <b>÷2 ÷3</b>{' '}
                even steps across the interval · <b>±step</b> a chosen step of{' '}
                {spec.chromatic.step100} · <b>cadence</b> five steps tuned so the two breaks in
                grey's rhythm match · <b>even</b> halfway to the dark end.
            </p>
        </div>
    );
}

// ------------------------------------------------------------------ the anchors ---

/**
 * One anchor: a swatch you can open, the hex you can type, what it does, what moving it costs,
 * and the way to let it go.
 */
function AnchorCard({
    label,
    hex,
    role,
    moves,
    onChange,
    onUnhook,
}: {
    label: string;
    hex: string;
    role: string;
    /**
     * Shades whose hex changes when this anchor's lightness moves by 0.01, from
     * `engine/reach.ts`. `null` when the nudge cannot solve in either direction — near a binding
     * constraint that is a real answer, so it is said rather than shown as zero.
     */
    moves?: number | null;
    onChange: (hex: string) => void;
    onUnhook: () => void;
}) {
    /*
       `dragging` has exactly one writer here, the colour picker. A text field commits once, on
       blur or Enter; a native `input[type=color]` fires `change` on every step as you drag inside
       its picker, so it needs the flag. `focus`/`blur` is the signal: the input keeps focus while
       its picker is open.
    */
    const setDragging = useStore((s) => s.setDragging);
    // Re-seeds when the spec changes from elsewhere — a reset, or a shared link — while staying
    // editable in between.
    const [draft, setDraft] = useResetOn(hex, hex);
    const [error, setError] = useState<string | null>(null);

    // Anchors are stored as hex, never as OKLCh: the conversion is not injective at 8 bits.
    // #F9F9FA read as L/C/H and written back lands on #F8F9FA. Commit takes the value as an
    // argument rather than reading `draft` from the closure — a stale-closure bug otherwise.
    const commit = (value: string) => {
        try {
            const next = normaliseHex(value);
            setError(null);
            onChange(next);
        } catch {
            setError('Not a hex colour');
        }
    };

    const o = (() => {
        try {
            return hexToOklch(hex);
        } catch {
            return null;
        }
    })();

    return (
        <article className="anchor-card">
            <div className="anchor-card-head">
                {/* The colour picker IS the swatch: `appearance-none` plus a fixed box turns the
                    native control into a plain square. */}
                <input
                    type="color"
                    value={hex}
                    aria-label={`${label} colour picker`}
                    title={`${label} — ${hex}`}
                    className="anchor-card-swatch border-input shrink-0 cursor-pointer appearance-none rounded-md border bg-transparent p-0 [&::-moz-color-swatch]:rounded-[5px] [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
                    onFocus={() => setDragging(true)}
                    onBlur={() => setDragging(false)}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        commit(e.target.value);
                    }}
                />
                <div className="anchor-card-id">
                    <span className="anchor-card-name text-sm font-semibold">{label}</span>
                    <Input
                        type="text"
                        value={draft}
                        spellCheck={false}
                        aria-label={`${label} hex`}
                        className="h-7 w-28 font-mono !text-xs"
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={(e) => commit(e.currentTarget.value)}
                        onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget.value)}
                    />
                </div>
            </div>
            {error && <Chip tone="bad">{error}</Chip>}
            <p className="anchor-card-role text-muted-foreground text-xs">{role}</p>
            {o && (
                <p className="anchor-card-lch text-muted-foreground font-mono text-xs tabular-nums">
                    L {o.L.toFixed(4)} · C {o.C.toFixed(3)} · h {o.H.toFixed(1)}°
                </p>
            )}
            <div className="anchor-card-foot text-xs">
                {/* The number that makes the card actionable: what you will see move. */}
                {moves !== undefined && (
                    <span
                        className="text-muted-foreground tabular-nums"
                        title={
                            moves === null
                                ? 'A 0.01 nudge does not solve in either direction from here — this anchor sits against a constraint'
                                : `Nudging this anchor by 0.01 in lightness changes the hex of ${moves} shades`
                        }
                    >
                        {moves === null ? (
                            <span className="text-foreground">at a constraint edge</span>
                        ) : (
                            <>
                                moves <span className="text-foreground font-medium">{moves}</span>{' '}
                                shades
                            </>
                        )}
                    </span>
                )}
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground h-7 px-2 text-xs"
                    onClick={onUnhook}
                    title={`Unhook ${label}: its shade derives from the ladder, and what it fed the ladder is kept as a number`}
                >
                    Unhook
                </Button>
            </div>
        </article>
    );
}

/**
 * A grey end after unhooking: the two numbers the ramps still read, with nothing to edit.
 * Read-only on purpose — there is no re-hook, so there is no control to offer.
 */
function UnhookedCard({
    label,
    role,
    end,
}: {
    label: string;
    role: string;
    end: { L: number; C: number };
}) {
    return (
        <article className="anchor-card unhooked">
            <div className="anchor-card-head">
                <span className="anchor-card-swatch border-input rounded-md border border-dashed" />
                <div className="anchor-card-id">
                    <span className="anchor-card-name text-sm font-semibold">{label}</span>
                    <span className="text-muted-foreground text-xs">unhooked</span>
                </div>
            </div>
            <p className="anchor-card-role text-muted-foreground text-xs">{role}</p>
            <p className="anchor-card-lch text-muted-foreground font-mono text-xs tabular-nums">
                L {end.L.toFixed(4)} · C {end.C.toFixed(3)}
            </p>
        </article>
    );
}

// ------------------------------------------------------------------- the reset ----

/**
 * Back to the shipped palette, and it asks first. The count is deliberately the number of
 * PALETTES, not of edits: forty slider moves are one authored palette.
 */
function ResetEverything() {
    const resetPalette = useStore((s) => s.resetPalette);
    const say = useStore((s) => s.say);
    const [confirming, setConfirming] = useState(false);
    const edits = useStore(paletteEditCount);

    if (!confirming) {
        return (
            <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                disabled={edits === 0}
                onClick={() => setConfirming(true)}
                title={
                    edits === 0
                        ? 'Nothing to discard — this palette matches the shipped one'
                        : 'Back to the palette the design system ships'
                }
            >
                Reset to the shipped palette
            </Button>
        );
    }

    return (
        <span className="pal-confirm text-muted-foreground text-xs">
            <span>Discard this palette?</span>
            <Button
                variant="destructive"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                    resetPalette();
                    setConfirming(false);
                    say('Back to the shipped palette');
                }}
            >
                Reset
            </Button>
            <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setConfirming(false)}
            >
                Keep
            </Button>
        </span>
    );
}
