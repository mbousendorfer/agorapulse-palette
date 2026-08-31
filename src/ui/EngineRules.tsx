/**
 * The five hexes the palette is seated on, and what follows from them.
 *
 * This panel used to hold twenty-six controls across five tabs — every knob the spec had,
 * exposed because it was settable. It is five now, and the cut was made from measurement:
 * each of the twenty-six was nudged, the palette re-solved, and the changed rungs counted.
 *
 * Nothing was dead. The weakest still moved 4 rungs of 66 and the strongest 49, so
 * "useless" was never the right charge. What the numbers actually said is that reach is
 * wildly uneven and the five ANCHORS carry it — 35, 37 and 49 rungs for the three brand
 * anchors, against 4 to 7 for a light-end chroma ceiling. Decision #1 has said the same
 * thing in words the whole time: you move an anchor, or you declare an off-ladder exception
 * with a recorded reason.
 *
 * Two findings worth keeping about what went:
 *
 *   `contrast700on200` and `contrast800on200` are BINDING at baseline — zero slack, both of
 *   them. Lowering either breaks it immediately; the only legal direction is to tighten.
 *   They are the rules the palette was solved against, not settings, and a slider implied
 *   otherwise. `Rules & audit` reports their state, which is where a rule belongs.
 *
 *   The two plateau divisors and grey's own `step100` were added by me with the
 *   justification "they were settable in the spec and unreachable from the app, which is
 *   the worst of both". That is a reason to expose something only if someone needs it.
 *   Settable is not needed — the same mistake as the curve view, in miniature.
 *
 * Everything cut is still in `spec/palette.baseline.json` and still solved from; it is
 * edited there, by someone changing the engine, rather than by a slider on a page whose
 * subject is the palette.
 *
 * The derivation stays, because it is the answer to this panel's own heading and it is a
 * read-out rather than an option: six lines showing how five hexes become a ladder.
 */

import { useMemo, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Chip } from './Chip';

import { hexToOklch, normaliseHex } from '../color/oklab';
import { evaluateConstraints } from '../engine/constraints';
import { anchorReach } from '../engine/reach';
import { useResetOn } from './useDerived';
import { paletteEditCount, useStore } from '../state/store';

export function EngineRules() {
    const spec = useStore((s) => s.spec);
    const solution = useStore((s) => s.solution);
    const updateSpec = useStore((s) => s.updateSpec);

    /*
       Ten solves, memoised on the spec.

       `anchorReach` nudges each of the five anchors both ways and re-solves — 3.3 ms a solve, so
       ~33 ms when the spec changes and nothing while it does not. That is affordable HERE and
       nowhere near the wall: this fold is closed by default and re-renders on a committed edit,
       not on a pointer move.
    */
    const reach = useMemo(() => anchorReach(spec), [spec]);

    // Memoised: ~30 contrastHex calls, and the panel re-renders on every palette edit.
    const constraints = useMemo(() => evaluateConstraints(spec, solution), [spec, solution]);
    const violated = constraints.filter((c) => c.status === 'violated');
    const binding = constraints.filter((c) => c.status === 'binding');
    const d = solution.derived;

    /*
       Folded by default, and plain `useState`.

       This used to follow `paletteView` from the store — unfolded in the curve view, folded
       in the grid. Both the view and the field are gone, and folded is the right default on
       its own terms: the palette above is the subject.
    */
    const [open, setOpen] = useState(false);

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
            <div className="fold-body">
                <Card>
                    <CardContent className="flex flex-col gap-8 pt-6">
                        <div className="flex flex-col gap-3">
                            <h3 className="text-foreground text-xs font-semibold">
                                The five anchors
                            </h3>
                            <p className="text-muted-foreground max-w-prose text-xs">
                                Every other shade is derived from these. The figure on each row is
                                measured, not remembered: it is how many of the{' '}
                                {solution.rungs.size} shades change hex when that anchor's lightness
                                moves by 0.01 — so it answers what you will see move, rather than
                                what structurally depends on it.
                            </p>
                            {spec.chromatic.families
                                .filter((f) => Object.keys(f.anchors).length > 0)
                                .map((family) =>
                                    Object.entries(family.anchors).map(([rung, hex]) => (
                                        <AnchorField
                                            key={`${family.id}.${rung}`}
                                            label={`${family.label} ${rung}`}
                                            hex={hex as string}
                                            moves={reach.get(`${family.id}.${rung}`)}
                                            onChange={(next) =>
                                                updateSpec((draft) => {
                                                    const f = draft.chromatic.families.find(
                                                        (x) => x.id === family.id,
                                                    );
                                                    if (f) f.anchors[Number(rung)] = next;
                                                })
                                            }
                                        />
                                    )),
                                )}
                            <AnchorField
                                label="Grey 100"
                                hex={spec.grey.anchor100}
                                moves={reach.get('grey.100')}
                                onChange={(next) =>
                                    updateSpec((x) => void (x.grey.anchor100 = next))
                                }
                            />
                            <AnchorField
                                label="Grey 1000"
                                hex={spec.grey.anchor1000}
                                moves={reach.get('grey.1000')}
                                onChange={(next) =>
                                    updateSpec((x) => void (x.grey.anchor1000 = next))
                                }
                            />
                        </div>

                        <div className="flex flex-col gap-4">
                            <h3 className="text-foreground text-xs font-semibold">
                                What follows from them
                            </h3>
                            {/* Read-only, and the reason this panel keeps its heading honest:
                                five inputs with no shown derivation would not be "how this
                                palette is built". The divisors named here are still in the
                                spec — they are just edited there rather than on a slider. */}
                            <ol className="chain [&_li]:border-b [&_li]:text-xs [&_li]:text-muted-foreground [&_li>span_em]:not-italic">
                                <li>
                                    <span>rung 700 &larr; the purple anchor&rsquo;s lightness</span>
                                    <b>{d.L700.toFixed(4)}</b>
                                </li>
                                <li>
                                    <span>rung 500 &larr; mean of the two brand anchors</span>
                                    <b>{d.L500.toFixed(4)}</b>
                                </li>
                                <li>
                                    <span>
                                        low plateau step = (500 &minus; 700) /{' '}
                                        {spec.chromatic.lowPlateauDivisor}
                                    </span>
                                    <b>{d.lowStep.toFixed(4)}</b>
                                </li>
                                <li>
                                    <span>
                                        rung 200 <strong>solved</strong> by contrast(700, 200) —
                                        binding family <em>{d.rung200Witness}</em>
                                    </span>
                                    <b>{d.L200.toFixed(4)}</b>
                                </li>
                                <li>
                                    <span>
                                        high plateau step = (200 &minus; 500) /{' '}
                                        {spec.chromatic.highPlateauDivisor}
                                    </span>
                                    <b>{d.highStep.toFixed(4)}</b>
                                </li>
                                <li>
                                    <span>rung 100 = 200 + step</span>
                                    <b>{solution.chromaticLadder[0].toFixed(4)}</b>
                                </li>
                            </ol>

                            {/*
                               One line, not a third copy of the table.

                               `Rules & audit` already lists all seven with signed slack and
                               named witnesses, and the status bar already carries this same
                               count. What this adds is immediacy: nudge an anchor and know
                               here whether you broke something, without leaving the screen.
                               Anything more than the count would be duplication.
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
                        </div>

                        {/* Reachable whenever the panel is open — the one destructive control
                            on the page, so it sits at the bottom of the fold rather than beside
                            the wall. */}
                        <div className="self-start">
                            <ResetEverything />
                        </div>
                    </CardContent>
                </Card>
            </div>
        </details>
    );
}

/**
 * Back to the shipped palette, and it asks first.
 *
 * In the full lab this button discarded two bodies of work — the palette AND a migration plan
 * across 64 components — so its confirmation named them separately. There is one here, so the
 * wording is one clause. The count is deliberately the number of PALETTES, not of edits: forty
 * slider moves are one authored palette, and "Discard 40 edits?" read as a threat to forty
 * things.
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

/**
 * One anchor: a swatch you can open, the hex you can type, what it reads in OKLCH, and how much
 * of the palette a nudge to it moves.
 *
 * ## What was wrong with the row before
 *
 * `.field > label` is `justify-content: space-between`, and this row filled the card — so the
 * OKLCH read-out was flung to the far right edge, roughly 1800px from the field it describes,
 * across nothing. Measured on screen: the input ended at 215px and `L 0.6440 · C 0.193 · h
 * 253.5°` started at 1670px.
 *
 * There were also TWO swatches per row showing the same colour — a 22px rounded `.dot` and a
 * 34px rectangular `input[type=color]`, in different shapes, one inert and one operable. The
 * native input is the one that does something, so it is the only one now, sized to read as a
 * swatch rather than as a browser widget.
 *
 * The row is constrained instead of centred or stretched: everything sits in one line at its
 * natural width, so the eye travels from the colour to its value to what moving it costs.
 */
function AnchorField({
    label,
    hex,
    moves,
    onChange,
}: {
    label: string;
    hex: string;
    /**
     * Shades whose hex changes when this anchor's lightness moves by 0.01, from
     * `engine/reach.ts`. `null` when the nudge cannot solve in either direction — near a
     * binding constraint that is a real answer, so it is said rather than shown as zero.
     */
    moves?: number | null;
    onChange: (hex: string) => void;
}) {
    /*
       `dragging` now has exactly one writer, and it is the colour picker below.

       It used to be set by eleven sliders. Those are gone, which left the flag with no
       writer at all while `SnapshotFrame` still read it — and what it gates is not cheap:
       the effect that folds the palette's inline custom properties into a real stylesheet,
       an `emitTokenCss` over the whole graph plus a `replaceSync`, deferred until a
       continuous edit releases.

       A text field commits once, on blur or Enter, so it does not need the flag. A native
       `input[type=color]` fires `change` on every step as you drag inside its picker, so it
       does. `focus`/`blur` is the signal: the input keeps focus while its picker is open.
       That is a proxy rather than a drag event — and if a platform does not hold focus
       there, the fallback is no deferral, which is exactly what deleting the flag would
       have given. Strictly no worse, and better where focus behaves.
    */
    const setDragging = useStore((s) => s.setDragging);
    // Re-seeds when the spec changes from elsewhere — a reset, or a shared link
    // being loaded — while staying editable in between.
    const [draft, setDraft] = useResetOn(hex, hex);
    const [error, setError] = useState<string | null>(null);

    // Anchors are stored as hex, never as OKLCh: the conversion is not injective
    // at 8 bits. #F9F9FA read as L/C/H and written back lands on #F8F9FA.
    //
    // Commit takes the value as an argument rather than reading `draft` from the
    // closure. Reading state here is a stale-closure bug: an input event and a
    // blur in the same tick see the pre-update `draft` and silently discard the
    // edit.
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/*
               The colour picker IS the swatch. `appearance-none` plus a fixed box turns the
               native control into a plain square — without it browsers draw their own inset
               border and padding, which is what made the old row need a second, tidier swatch
               beside it.
            */}
            <input
                type="color"
                value={hex}
                aria-label={`${label} colour picker`}
                title={`${label} — ${hex}`}
                className="border-input size-7 shrink-0 cursor-pointer appearance-none rounded-md border bg-transparent p-0 [&::-moz-color-swatch]:rounded-[3px] [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-[3px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
                onFocus={() => setDragging(true)}
                onBlur={() => setDragging(false)}
                onChange={(e) => {
                    setDraft(e.target.value);
                    commit(e.target.value);
                }}
            />
            <span className="w-32 shrink-0 text-xs">{label}</span>
            <Input
                type="text"
                value={draft}
                spellCheck={false}
                aria-label={`${label} hex`}
                className="w-28 shrink-0 font-mono !text-xs"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={(e) => commit(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget.value)}
            />
            {/* Next to the value, not at the far edge of the card. */}
            {o && (
                <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
                    L {o.L.toFixed(4)} · C {o.C.toFixed(3)} · h {o.H.toFixed(1)}°
                </span>
            )}
            {/*
               The number that makes the row actionable, and the one the panel's prose used to
               carry for only three of the five anchors without saying which was which.
            */}
            {moves !== undefined && (
                <span
                    className="text-muted-foreground shrink-0 text-[11px] tabular-nums"
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
                            moves <span className="text-foreground">{moves}</span>
                        </>
                    )}
                </span>
            )}
            {error && <Chip tone="bad">{error}</Chip>}
        </div>
    );
}
