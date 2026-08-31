/**
 * Inspect and edit one shade.
 *
 * The thing this panel has to get right is CONSEQUENCE. Two edits exist in the
 * engine and they do very different things — moving an anchor rebuilds the whole
 * scale, pinning a shade moves only itself — and a designer who confuses them
 * will pin green-600 and wonder why green-700 did not follow.
 *
 * The earlier version showed both as two near-identical hex fields and disabled
 * whichever did not apply, with the difference explained in small grey prose
 * underneath. That is backwards twice over: a disabled control invites you to
 * try to enable it, and the consequence was the least visible thing on the card.
 *
 * The insight that fixes it: on any given shade there is only ever ONE edit
 * available. Either the shade is an anchor, in which case editing it rebuilds
 * the scale, or it is not, in which case editing it pins that shade. So show one
 * field, and state what it will do in plain language, prominently, before it.
 */

import { useMemo, useState } from 'react';

import { Segmented, SegmentedItem } from './Segmented';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Chip } from './Chip';
import { ChannelField } from './ChannelField';

import { contrastHex, hexToOklch, inGamut, normaliseHex, oklchToHex } from '../color/oklab';
import { hexToHsl, hslToHex } from '../color/hsl';
import { deriveChromaFactor } from '../engine/chroma';
import { solvePalette } from '../engine/solve';
import { wcagLevel } from '../engine/constraints';
import { rungRef } from '../engine/types';
import { useStore } from '../state/store';

export function RungInspector({ family, rung }: { family: string; rung: number }) {
    const spec = useStore((s) => s.spec);
    const solution = useStore((s) => s.solution);
    const updateSpec = useStore((s) => s.updateSpec);
    const selectToken = useStore((s) => s.selectToken);
    const say = useStore((s) => s.say);
    const setDragging = useStore((s) => s.setDragging);

    const solved = solution.rungs.get(rungRef(family, rung));
    const isGrey = family === 'grey';
    const familySpec = spec.chromatic.families.find((f) => f.id === family);

    const anchorHex = isGrey
        ? rung === 100
            ? spec.grey.anchor100
            : rung === 1000
              ? spec.grey.anchor1000
              : undefined
        : familySpec?.anchors[rung];

    const override = spec.overrides.find((o) => o.rung === rungRef(family, rung));
    const isAnchor = anchorHex !== undefined;

    /** How many shades this edit will move — the number that makes it concrete. */
    const blastRadius = useMemo(() => (isAnchor ? solution.rungs.size : 1), [isAnchor, solution]);

    /**
     * What the edit is allowed to move.
     *
     * `shade` records an off-ladder exception: one rung leaves the ladder and the
     * other 65 do not move. `ramp` reads the new colour's HUE and CHROMA and gives
     * them to the whole family, so all eight of its rungs re-derive.
     *
     * They are genuinely different intentions and the panel used to offer only the
     * first — so wanting a slightly different green meant pinning eight
     * exceptions by hand, each one a recorded deviation from a ladder it was
     * actually agreeing with.
     */
    const [scope, setScope] = useState<'shade' | 'ramp'>('shade');

    const [draft, setDraft] = useState(solved?.hex ?? '#000000');
    /*
       Which space the three sliders are in. The colour is a hex either way.

       View state, so it resets with the panel rather than persisting. Someone who thinks in HSL
       will switch once per shade, which is cheaper than a preference nobody remembers setting.
    */
    const [space, setSpace] = useState<'oklch' | 'hsl'>('oklch');
    const [reason, setReason] = useState(override?.reason ?? '');
    const [error, setError] = useState<string | null>(null);

    /**
     * Re-seed the fields when the shade underneath them moves.
     *
     * Adjusting state during render rather than in an effect: this is the pattern
     * React documents for "derive from props, but keep it editable", and it avoids
     * the extra commit an effect would cost on every re-solve — which happens on
     * every keystroke while a ramp edit is being typed.
     *
     * The re-seed is deliberate, not incidental: a `ramp` commit lands the rung at
     * the ladder's lightness rather than at the hex you typed, and the field has to
     * show where it actually landed.
     */
    /*
       The three channels are held as state, not derived from `draft` on every render, and that
       is a correctness point rather than a performance one.

       `oklchToHex` is not injective at 8 bits — the module says so, and `#F9F9FA` read as
       L/C/H and written back lands on `#F8F9FA`. Deriving the channels from the hex each frame
       would feed that 1-LSB drift back into the sliders, so a hue drag would slowly walk the
       lightness. Holding LCH as the source of truth while the sliders are in use and writing
       hex OUT keeps the drift to the single conversion at the end.
    */
    const [lch, setLch] = useState(() => {
        try {
            return hexToOklch(solved?.hex ?? '#000000');
        } catch {
            return { L: 0, C: 0, H: 0 };
        }
    });

    /*
       And the HSL triple, held for exactly the same reason.

       `hexToHsl` rounds to the integers a designer types, so it loses more than the OKLCH
       round trip does — `#64a0e6` and `#64a1e6` are one `212 / 72% / 65%`, measured in
       `color/hsl.ts`.

       What that rounding actually does was measured rather than assumed, because the obvious
       fear is that it accumulates. It does not: sweeping hue 120 -> 200 -> 120 in 4-degree
       steps, committing on every step, leaves saturation and lightness exactly where they
       started. What you DO see is one step at the start — the shipped `#ada8f2` rounds to 74%
       saturation and the first hex committed from it rounds back to 75% — and that is the
       rounding being honest rather than drifting. The sliders always describe the committed
       hex, which is the invariant worth keeping in a tool whose output is the hex.
    */
    const [hsl, setHsl] = useState(() => {
        try {
            return hexToHsl(solved?.hex ?? '#000000');
        } catch {
            return { h: 0, s: 0, l: 0 };
        }
    });

    const [seededFrom, setSeededFrom] = useState(solved?.hex);
    if (solved?.hex !== seededFrom) {
        setSeededFrom(solved?.hex);
        setDraft(solved?.hex ?? '#000000');
        try {
            setLch(hexToOklch(solved?.hex ?? '#000000'));
            setHsl(hexToHsl(solved?.hex ?? '#000000'));
        } catch {
            /* A rung with an unparseable hex cannot happen — the solver produces them — but
               the seed must not be the thing that throws if it ever does. */
        }
    }
    const [seededReason, setSeededReason] = useState(override?.reason);
    if (override?.reason !== seededReason) {
        setSeededReason(override?.reason);
        setReason(override?.reason ?? '');
    }

    /**
     * Where the edited rung will actually land in `ramp` mode.
     *
     * Stating this is the difference between a feature and a surprise: you type
     * #0D9930 on green 600, and green 600 comes out at the ladder's lightness for
     * 600 with your hue — close, but not your hex.
     *
     * Declared HERE, above the `!solved` guard, because it is a hook: below the
     * guard React saw a different number of hooks on the render where a rung has no
     * solution, which is the "rendered fewer hooks than expected" crash.
     */
    const rampLanding = useMemo(() => {
        if (scope !== 'ramp' || isGrey) return null;
        try {
            const { L, C, H } = hexToOklch(normaliseHex(draft));
            // Run the real solver on a draft spec rather than reproducing the
            // chroma pipeline here. It costs ~3 ms and it cannot drift from what
            // committing will actually do — which a second implementation would.
            const trial = structuredClone(spec);
            const f = trial.chromatic.families.find((x) => x.id === family);
            if (!f) return null;
            f.hue = H;
            f.chromaFactor = deriveChromaFactor(L, C, H);
            return solvePalette(trial).rungs.get(rungRef(family, rung))?.hex ?? null;
        } catch {
            // A refusal here is not an error to report: the commit surfaces it.
            return null;
        }
    }, [scope, isGrey, draft, spec, family, rung]);

    if (!solved) return null;

    const ladderIndex = isGrey ? rung / 100 - 1 : solution.chromaticRungs.indexOf(rung);
    const ladderL = isGrey
        ? solution.greyLadder[ladderIndex]
        : solution.chromaticLadder[ladderIndex];

    /*
       One writer for all three channels: move the channel, derive the hex, commit.

       `commit` is what every other control here calls, so a slider cannot diverge from what
       typing a hex does — including the refusal path, where `updateSpec` keeps the last good
       solution and the handle simply stops.
    */
    const setChannel = (next: { L: number; C: number; H: number }) => {
        setLch(next);
        write(oklchToHex(next.L, next.C, next.H));
    };

    const setHslChannel = (next: { h: number; s: number; l: number }) => {
        setHsl(next);
        write(hslToHex(next));
    };

    /*
       Both spaces land here, so a slider in either one cannot diverge from what typing a hex
       does — including the refusal path, where `updateSpec` keeps the last good solution and
       the handle simply stops.

       The OTHER space's triple is deliberately NOT re-derived here. Switching space re-seeds it
       from the hex, which is one conversion; keeping both in step per pointer move would push
       each space's rounding into the other and both would drift.
    */
    const write = (hex: string) => {
        setDraft(hex);
        commit(hex);
    };

    // Commit takes the value as an argument rather than reading state: an input
    // and a blur in the same tick would otherwise see the pre-update draft and
    // silently drop the edit.
    const commit = (value: string, note = reason) => {
        let hex: string;
        try {
            hex = normaliseHex(value);
        } catch {
            setError('Not a hex colour');
            return;
        }
        setError(null);

        updateSpec((d) => {
            if (isAnchor) {
                if (isGrey) {
                    if (rung === 100) d.grey.anchor100 = hex;
                    else d.grey.anchor1000 = hex;
                } else {
                    const f = d.chromatic.families.find((x) => x.id === family);
                    if (f) f.anchors[rung] = hex;
                }
                return;
            }
            if (scope === 'ramp' && familySpec) {
                // Hue and chroma come from the new colour; LIGHTNESS stays on the
                // shared ladder, which is what keeps rung 600 meaning the same
                // lightness in every family. So the edited rung lands near the
                // hex you typed, not on it — the panel says so before you commit.
                const { L, C, H } = hexToOklch(hex);
                const f = d.chromatic.families.find((x) => x.id === family);
                if (f) {
                    f.hue = H;
                    f.chromaFactor = deriveChromaFactor(L, C, H);
                }
                return;
            }
            const ref = rungRef(family, rung);
            const existing = d.overrides.find((o) => o.rung === ref);
            if (existing) {
                existing.hex = hex;
                existing.reason = note || existing.reason;
            } else {
                d.overrides.push({ rung: ref, hex, reason: note || 'Pinned in Color Lab.' });
            }
        });
    };

    const reset = () =>
        updateSpec((d) => {
            d.overrides = d.overrides.filter((o) => o.rung !== rungRef(family, rung));
        });

    const draftOklch = (() => {
        try {
            return hexToOklch(normaliseHex(draft));
        } catch {
            return null;
        }
    })();
    const step = ladderIndex >= 4 ? solution.derived.lowStep : solution.derived.highStep;
    const deltaL = draftOklch && ladderL !== undefined ? draftOklch.L - ladderL : null;

    /*
       One status line, four possible messages, in priority order: what is wrong, then how far
       the value is bent, then that it is on the ladder. Computed here rather than inline so the
       `title` and the text cannot drift apart.
    */
    const statusLine = (() => {
        if (!inGamut(lch.L, lch.C, lch.H)) return 'Outside sRGB — the hex is clamped.';
        if (isAnchor) return 'An anchor: the ladder is derived from it.';
        if (deltaL !== null && Math.abs(deltaL) > 0.0002) {
            const dir = deltaL > 0 ? 'lighter' : 'darker';
            const pct = Math.abs((deltaL / step) * 100).toFixed(0);
            return `${Math.abs(deltaL).toFixed(4)} ${dir} than the ladder — ${pct}% of a step`;
        }
        return 'On the ladder.';
    })();

    const on = (other: number) => {
        const o = solution.rungs.get(rungRef(family, other));
        return o ? contrastHex(solved.hex, o.hex) : null;
    };

    return (
        <section className="inspector shadow-lg rounded-lg border border-input">
            {/* --- identity: the shade, big, with its value ------------------ */}
            <header className="insp-head">
                <div className="insp-chip rounded-md" style={{ background: solved.hex }} />
                <div className="insp-id [&_h2]:text-sm [&_h2]:font-bold [&_h2_span]:text-muted-foreground [&_h2_span]:font-normal">
                    <h2>
                        {family} <span>{rung}</span>
                    </h2>
                    <button
                        className="insp-hex text-base font-mono border-b border-dashed border-transparent"
                        title="Copy"
                        onClick={() => {
                            // Confirm the copy AFTER it resolves. `void` plus an
                            // immediate toast announced a copy that a blocked
                            // clipboard never performed.
                            navigator.clipboard
                                ?.writeText(solved.hex)
                                .then(() => say(`${solved.hex} copied`))
                                .catch(() => say('Rejected: the browser blocked the clipboard'));
                        }}
                    >
                        {solved.hex}
                    </button>
                </div>
                <dl className="insp-facts [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:text-sm [&_dd]:font-mono [&_dd_em.bad]:text-destructive [&_dd_em.ok]:text-primary [&_dd_em]:not-italic">
                    <Fact label="lightness" value={solved.L.toFixed(4)} />
                    {/* The constraint pair, and only on the rung the constraint
                        actually names — 700 for the chromatic families, 800 for
                        grey. Showing it on every dark rung implies a rule that
                        does not exist. */}
                    {rung === (isGrey ? 800 : 700) && on(200) !== null && (
                        <Fact
                            label="on its 200 · the 4.5 rule"
                            value={on(200)!.toFixed(2)}
                            grade={wcagLevel(on(200)!)}
                        />
                    )}
                    <Fact
                        label="on white"
                        value={contrastHex(solved.hex, '#FFFFFF').toFixed(2)}
                        grade={
                            rung >= 600 ? wcagLevel(contrastHex(solved.hex, '#FFFFFF')) : undefined
                        }
                    />
                </dl>
                {/* A glyph: the word cost more room than the reading it gave, in
                    a header whose job is the colour and its two measurements. */}
                <button
                    className="insp-close rounded-sm border border-transparent text-muted-foreground text-xs hover:border-input leading-none"
                    onClick={() => selectToken(null)}
                    title="Close — or press Escape"
                    aria-label="Close"
                >
                    ✕
                </button>
            </header>

            {/* --- the single edit, and what it will do ---------------------- */}
            <div className="insp-edit border-t bg-background">
                {isAnchor ? (
                    <Alert className="mb-6">
                        {/* `line-clamp-none`: `AlertTitle` clamps to one line, and this
                            title is a sentence that wraps at the inspector's width. */}
                        <AlertTitle className="line-clamp-none">
                            This shade is an anchor — editing it rebuilds the scale
                        </AlertTitle>
                        <AlertDescription>
                            All {blastRadius} shades re-derive from it, across every family.
                        </AlertDescription>
                    </Alert>
                ) : (
                    <div className="insp-scope rounded-md bg-muted border-l">
                        {/* Scope is one choice of two, and the `ramp` half is disabled for
                            grey. `ToggleGroup` keeps a disabled option out of the keyboard
                            order, which two `aria-pressed` buttons did not. */}
                        <Segmented
                            type="single"
                            size="sm"
                            value={scope}
                            onValueChange={(value) => value && setScope(value as typeof scope)}
                            aria-label="What this edit changes"
                        >
                            <SegmentedItem
                                value="shade"
                                className="px-2 text-xs"
                                title="Hold this one rung off the ladder, and record why"
                            >
                                This shade only
                            </SegmentedItem>
                            <SegmentedItem
                                value="ramp"
                                className="px-2 text-xs"
                                disabled={isGrey}
                                title={
                                    isGrey
                                        ? 'Grey has no hue to give a ramp — its scale is set by its two anchors'
                                        : `Give ${familySpec?.label ?? family}'s whole ramp this hue and chroma`
                                }
                            >
                                The whole {isGrey ? 'grey scale' : (familySpec?.label ?? family)}{' '}
                                ramp
                            </SegmentedItem>
                        </Segmented>
                        <span className="insp-scope-note text-xs text-muted-foreground [&_b]:font-semibold leading-normal">
                            {scope === 'shade' ? (
                                <>
                                    One rung leaves the ladder. The other {solution.rungs.size - 1}{' '}
                                    shades stay exactly where they are.
                                </>
                            ) : (
                                <>
                                    All {solution.chromaticRungs.length} of this family's shades
                                    re-derive from this hue and chroma. Its lightness stays on the
                                    shared ladder, so {family}-{rung} lands at{' '}
                                    <b className="font-mono">{rampLanding ?? '—'}</b>
                                    {rampLanding &&
                                    rampLanding.toLowerCase() !== draft.toLowerCase()
                                        ? ' — near your colour, not on it.'
                                        : '.'}
                                </>
                            )}
                        </span>
                    </div>
                )}

                <div className="insp-field [&_input[type=color]]:border-0 [&_input[type=color]]:bg-transparent">
                    <input
                        type="color"
                        value={/^#[0-9a-f]{6}$/i.test(draft) ? draft : '#000000'}
                        onChange={(e) => {
                            setDraft(e.target.value);
                            commit(e.target.value);
                        }}
                    />
                    <Input
                        type="text"
                        /*
                           A FIXED width, and it is not cosmetic. shadcn's `Input` carries
                           `w-full`, which beats `.insp-hexinput`'s `width` because utilities
                           outrank the components layer — so the field filled the row and then
                           SHRANK the moment "Reset to the ladder" appeared beside it. One more
                           thing moving while you edit.
                        */
                        className="insp-hexinput w-44 shrink-0 !text-sm"
                        value={draft}
                        spellCheck={false}
                        aria-label="Hex value"
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={(e) => commit(e.currentTarget.value)}
                        onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget.value)}
                    />
                    {error && <Chip tone="bad">{error}</Chip>}
                    {(override || (isAnchor && solved.provenance.kind === 'anchor')) &&
                        override && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={reset}
                            >
                                Reset to the ladder
                            </Button>
                        )}
                </div>

                {/*
                   Adjust the colour by channel, not only by hex.

                   Typing a hex is precise and useless for "a little less green" — the whole
                   reason this panel exists is judging a hue against its neighbours, and that is
                   a nudge, not a value you can name. Each channel commits on every pointer
                   move, so the wall behind the panel re-solves live; `onDragChange` sets the
                   store's `dragging` flag, which is what stops the swatches transitioning and
                   silences the rejection toast for the frames where a constraint refuses.

                   Chroma's ceiling is 0.37, which is past sRGB everywhere — the gamut note
                   below says when the value being shown has been clamped, rather than the
                   slider pretending the top of its track is reachable.
                */}
                <div className="mt-4 flex flex-col gap-2">
                    {/*
                       The space is a CHOICE, and naming it is what keeps the panel honest.

                       Both triples describe the same colour and none of their numbers agree:
                       #ada8f2 is OKLCH L 0.7645 / C 0.1051 / H 286.7 and HSL 244 / 74% / 80%.
                       Two lightnesses and two hues, neither wrong. Showing one triple at a time
                       under its own name is why this is a switch rather than six sliders.

                       OKLCH is the default because the ladder IS a ladder in OKLab: a step here
                       is a step the engine reasons about, which is the whole reason the palette
                       is solvable rather than drawn. HSL is here because it is what Figma, most
                       pickers and most CSS say, so it is what people have to hand — but nudging
                       HSL lightness does not move a rung by a predictable perceptual step.
                    */}
                    <div className="flex items-center gap-3">
                        <Segmented
                            type="single"
                            size="sm"
                            value={space}
                            onValueChange={(v) => v && setSpace(v as typeof space)}
                            aria-label="Channel space"
                        >
                            <SegmentedItem
                                value="oklch"
                                className="px-2 font-mono text-xs"
                                title="Perceptual — the space the ladder is built in"
                            >
                                OKLCH
                            </SegmentedItem>
                            <SegmentedItem
                                value="hsl"
                                className="px-2 font-mono text-xs"
                                title="CSS sRGB — what a picker or a stylesheet will hand you"
                            >
                                HSL
                            </SegmentedItem>
                        </Segmented>
                        <span className="text-muted-foreground text-xs">
                            {space === 'oklch'
                                ? 'a step here is a step the engine understands'
                                : 'sRGB — a step here is not a perceptual step'}
                        </span>
                    </div>

                    {space === 'oklch' ? (
                        <>
                            <ChannelField
                                label="Lightness"
                                value={lch.L}
                                min={0}
                                max={1}
                                step={0.001}
                                decimals={4}
                                onChange={(L) => setChannel({ ...lch, L })}
                                onDragChange={setDragging}
                            />
                            <ChannelField
                                label="Chroma"
                                value={lch.C}
                                min={0}
                                max={0.37}
                                step={0.001}
                                decimals={4}
                                onChange={(C) => setChannel({ ...lch, C })}
                                onDragChange={setDragging}
                            />
                            <ChannelField
                                label="Hue"
                                value={lch.H}
                                min={0}
                                max={360}
                                step={0.1}
                                decimals={1}
                                unit="°"
                                onChange={(H) => setChannel({ ...lch, H })}
                                onDragChange={setDragging}
                            />
                        </>
                    ) : (
                        /* Hue first, because that is the order HSL is written in and the order
                           every picker shows. The OKLCH group above starts with lightness for
                           the same reason: it is the order the ladder is built in. */
                        <>
                            <ChannelField
                                label="Hue"
                                value={hsl.h}
                                min={0}
                                max={360}
                                step={1}
                                decimals={0}
                                unit="°"
                                onChange={(h) => setHslChannel({ ...hsl, h })}
                                onDragChange={setDragging}
                            />
                            <ChannelField
                                label="Saturation"
                                value={hsl.s}
                                min={0}
                                max={100}
                                step={1}
                                decimals={0}
                                unit="%"
                                onChange={(sat) => setHslChannel({ ...hsl, s: sat })}
                                onDragChange={setDragging}
                            />
                            <ChannelField
                                label="Lightness"
                                value={hsl.l}
                                min={0}
                                max={100}
                                step={1}
                                decimals={0}
                                unit="%"
                                onChange={(l) => setHslChannel({ ...hsl, l })}
                                onDragChange={setDragging}
                            />
                        </>
                    )}
                </div>

                {/*
                   ONE status line, and it always renders — which is the fix to the panel
                   jumping while you drag.

                   Three separate things used to appear and disappear here: the delta sentence
                   (gated on |deltaL| > 0.0002, so it flickered in and out as the slider crossed
                   the threshold), the out-of-gamut warning, and the lightness hint. Each was a
                   row that grew, and near the bottom of the wall this panel is anchored by its
                   BOTTOM edge — `.swatch-pop[data-flip]` — so every one of those moved the whole
                   thing under the cursor.

                   Now the slot is always there and only its text changes, in priority order:
                   what is wrong, then how far the value is bent, then that it is on the ladder.
                   "On the ladder" is also better than silence, which used to mean both "no
                   override" and "too small to mention".
                */}
                {/*
                   `truncate` is the guard, and it is why this line can never move the panel
                   again.

                   Making the slot always render was only half the fix. Its four messages have
                   very different lengths — "Outside sRGB…" is about 68 characters against the
                   delta sentence's 45 — so in a 470px panel the gamut branch WRAPPED TO TWO
                   LINES, and dragging chroma past the sRGB boundary grew the fold by a row.
                   Near the bottom of the wall the panel is anchored by its bottom edge
                   (`.swatch-pop[data-flip]`), so that row moved everything under the cursor.

                   Clipping rather than wrapping makes the height independent of the wording,
                   which is the property worth having: the next message somebody adds here
                   cannot reintroduce the bug. The messages are also kept short enough that
                   nothing clips in practice — `title` carries the full text either way.
                */}
                <p className="insp-delta truncate text-xs" title={statusLine}>
                    {statusLine}
                </p>

                {!isAnchor && (
                    <label className="insp-reason [&_span]:text-xs [&_span]:text-muted-foreground">
                        <span>Why is it leaving the ladder?</span>
                        <Input
                            type="text"
                            value={reason}
                            placeholder="recorded alongside the value"
                            onChange={(e) => setReason(e.target.value)}
                            onBlur={(e) => override && commit(draft, e.currentTarget.value)}
                        />
                    </label>
                )}
            </div>
        </section>
    );
}

function Fact({ label, value, grade }: { label: string; value: string; grade?: string }) {
    return (
        <div>
            <dt>{label}</dt>
            <dd>
                {value}
                {grade && (
                    <em className={grade === 'fail' ? 'bad' : grade === 'AA-L' ? 'warn' : 'ok'}>
                        {grade}
                    </em>
                )}
            </dd>
        </div>
    );
}
