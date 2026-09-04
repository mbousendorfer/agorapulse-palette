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
 *
 * ## The panel reads top-down in the order you need things
 *
 * Four tiers, each with one job, and the type ramp follows the tiers rather than
 * being flat across them:
 *
 *   the plate      the colour itself, full-bleed, with its name set on it in the ink
 *                  that measures best against it. A 56px chip beside a bold word was
 *                  a form field's idea of a colour; a chip card's idea is the colour
 *                  IS the header.
 *   the read-out   lightness and the contrasts, in mono, label-over-value. Facts about
 *                  where this shade stands, not channels you can turn — the channels
 *                  are the sliders' job, and stating them twice put two lightnesses
 *                  four decimals apart on one card.
 *   the edit       what this edit will move, then the colour controls. Two segmented
 *                  controls used to sit one above the other in the same dress, so "what
 *                  does this change" (a decision) and "which space" (a view) read as
 *                  the same kind of thing. The space switch now sits with the sliders it
 *                  governs, right-aligned, and the scope has the room and a caption.
 *   the foot       the note and the one undoing action, off the working area.
 */

import { useMemo, useState } from 'react';
import { Copy, X } from 'lucide-react';

import { Segmented, SegmentedItem } from './Segmented';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Chip } from './Chip';
import { ChannelEditor } from './ChannelEditor';

import { contrastHex, hexToOklch, inkOn, normaliseHex } from '../color/oklab';
import { detachAny, detachPreview } from '../engine/anchors';
import { deriveChromaFactor } from '../engine/chroma';
import { solvePalette } from '../engine/solve';
import { wcagLevel } from '../engine/constraints';
import { isGreyHex, rungRef } from '../engine/types';
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
    const label = isGrey ? 'Grey' : (familySpec?.label ?? family);

    /*
       A grey end counts as an anchor only while it is still a hex. Once unhooked it is an
       `{ L, C }` and this rung is derived like any other — treating it as an anchor here would
       let a hex edit quietly hook it back, which is not an edit this panel offers.
    */
    const greyEnd =
        rung === 100 ? spec.grey.anchor100 : rung === 1000 ? spec.grey.anchor1000 : null;
    const anchorHex = isGrey
        ? greyEnd !== null && isGreyHex(greyEnd)
            ? greyEnd
            : undefined
        : familySpec?.anchors[rung];

    const override = spec.overrides.find((o) => o.rung === rungRef(family, rung));
    const isAnchor = anchorHex !== undefined;

    /** How many shades this edit will move — the number that makes it concrete. */
    const blastRadius = useMemo(() => (isAnchor ? solution.rungs.size : 1), [isAnchor, solution]);

    /**
     * What the edit is allowed to move.
     *
     * `ramp` reads the new colour's HUE and CHROMA and gives them to the whole family, so all
     * eight of its rungs re-derive. `shade` records an off-ladder exception: one rung leaves
     * the ladder and the other 65 do not move.
     *
     * `ramp` is the default because it is the one that AGREES with the ladder — wanting a
     * slightly different green is re-hueing the family, not pinning eight exceptions to a
     * ladder you actually accept. `shade` is the deliberate departure, so it is the one you
     * reach for. Grey has no hue to give a ramp, so it starts on `shade`, its only option.
     */
    const [scope, setScope] = useState<'shade' | 'ramp'>(isGrey ? 'shade' : 'ramp');

    const [draft, setDraft] = useState(solved?.hex ?? '#000000');
    const [reason, setReason] = useState(override?.reason ?? '');
    /* The note is off by default and revealed by a link. A shade that already carries one shows
       it open, so an existing reason is never hidden behind a click. */
    const [reasonAsked, setReasonAsked] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /* Whether the last channel move asked for a colour sRGB can hold. Starts true: a solved
       rung is in gamut by construction, and so is every hex a re-seed can bring in. */
    const [requestedInGamut, setRequestedInGamut] = useState(true);

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
    const [seededFrom, setSeededFrom] = useState(solved?.hex);
    if (solved?.hex !== seededFrom) {
        setSeededFrom(solved?.hex);
        setDraft(solved?.hex ?? '#000000');
        /* The channel triples re-seed themselves: `ChannelEditor` takes `solved.hex` and
           watches it, so there is one place that knows how to turn a hex into sliders. */
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

    /*
       What unhooking this anchor would do, found by doing it on a copy and solving — the same
       reasoning as `rampLanding`: a second implementation of "where does it land" would drift
       from the commit. Above the guard, because it is a hook.
    */
    const unhook = useMemo(
        () => (isAnchor ? detachPreview(spec, solution, family, rung) : null),
        [isAnchor, spec, solution, family, rung],
    );

    if (!solved) return null;

    const ladderIndex = isGrey ? rung / 100 - 1 : solution.chromaticRungs.indexOf(rung);
    const ladderL = isGrey
        ? solution.greyLadder[ladderIndex]
        : solution.chromaticLadder[ladderIndex];

    /*
       Both spaces land here, so a slider in either one cannot diverge from what typing a hex
       does — including the refusal path, where `updateSpec` keeps the last good solution and
       the handle simply stops.

       The OTHER space's triple is deliberately NOT re-derived here. Switching space re-seeds it
       from the hex, which is one conversion; keeping both in step per pointer move would push
       each space's rounding into the other and both would drift.
    */
    const write = (hex: string, meta: { inGamut: boolean }) => {
        setDraft(hex);
        /* The sliders' own verdict, not one derived from the hex — `oklchToHex` clamps, so a
           hex is always in gamut and asking it would always answer "fine". Only the editor
           knows the value that was requested. */
        setRequestedInGamut(meta.inGamut);
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

    /*
       Unhook: the anchor goes, what it fed the derivation stays as numbers — see `anchors.ts`.
       One `updateSpec`, so it is one undo step, and the toast says what changed hands rather
       than only that something did.
    */
    const unhookNow = () => {
        updateSpec((d) => detachAny(d, family, rung));
        say(
            unhook?.feedsLadder
                ? `${family} ${rung} unhooked — derived now; the ladder kept its lightness`
                : `${family} ${rung} unhooked — derived now`,
        );
    };

    /*
       The consequence of unhooking, as one sentence, before the button that does it. Four
       shapes, from the trial solve: lands on the same hex; lands elsewhere and nothing else
       moves; other shades move too; or the trial did not solve.
    */
    const unhookNote = (() => {
        if (!isAnchor) return null;
        if (!unhook) return { short: 'Unhooking it does not solve from here.', full: null };
        const same = unhook.landsAt.toLowerCase() === solved?.hex.toLowerCase();
        const others = unhook.changedHexes - (same ? 0 : 1);
        const tail =
            others === 0
                ? 'nothing else moves'
                : `${others} other shade${others === 1 ? '' : 's'} move${others === 1 ? 's' : ''}`;
        const ladder = unhook.feedsLadder ? ' The ladder keeps the lightness it set.' : '';
        const full = same
            ? `Unhook it and this shade stays at ${unhook.landsAt} — the same hex, now derived — and ${tail}.${ladder}`
            : `Unhook it and this shade falls back onto the ladder at ${unhook.landsAt}, and ${tail}.${ladder}`;
        /* The same facts in one line, for the foot, beside the button that causes them. The
           long form is its `title`, so nothing the sentence says is lost to the clip. */
        const short = same
            ? `Stays at ${unhook.landsAt}, now derived · ${tail}${unhook.feedsLadder ? ' · ladder lightness kept' : ''}`
            : `Lands on the ladder at ${unhook.landsAt} · ${tail}${unhook.feedsLadder ? ' · ladder lightness kept' : ''}`;
        return { short, full };
    })();

    /*
       What the chosen scope will move, as one line under the switch. The tooltips on the two
       options carry the long form; this is the short form that is always in view, because the
       consequence is the reason the switch exists and a tooltip is not "in view".
    */
    const consequence = (() => {
        if (isAnchor) return null;
        if (scope === 'ramp') {
            const n = solution.chromaticRungs.length;
            const landing = rampLanding ? ` · ${label} ${rung} lands at ${rampLanding}` : '';
            return `All ${n} ${label} shades re-derive on the ladder${landing}`;
        }
        return `Only this shade moves · the other ${solution.rungs.size - 1} stay where they are`;
    })();

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
        if (!requestedInGamut) return 'Outside sRGB — the hex is clamped.';
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
    const onWhite = contrastHex(solved.hex, '#FFFFFF');

    const copyHex = () => {
        // Confirm the copy AFTER it resolves. `void` plus an immediate toast announced a
        // copy that a blocked clipboard never performed.
        navigator.clipboard
            ?.writeText(solved.hex)
            .then(() => say(`${solved.hex} copied`))
            .catch(() => say('Rejected: the browser blocked the clipboard'));
    };

    return (
        <section className="inspector" aria-label={`${label} ${rung}`}>
            {/* --- the plate: the colour, full-bleed, named in its own ink -------------
                `inkOn` picks black or white by measured contrast, and the loser of that
                contest is never under 4.5:1 on any sRGB colour, so everything set on the
                plate clears AA whatever the shade. The inset hairline is `--foreground` at
                low alpha rather than a fixed grey, so a near-white plate in light mode and
                a near-black one in dark mode both keep an edge against the card. */}
            <header
                className="insp-plate"
                style={{ background: solved.hex, color: inkOn(solved.hex) }}
            >
                <h2 className="flex items-baseline gap-2 text-lg leading-none font-semibold tracking-tight">
                    {label}
                    <span className="font-mono text-base font-normal tracking-normal tabular-nums">
                        {rung}
                    </span>
                </h2>
                <button
                    type="button"
                    className="insp-close rounded-md hover:bg-current/15 focus-visible:bg-current/15"
                    onClick={() => selectToken(null)}
                    title="Close — or press Escape"
                    aria-label="Close"
                >
                    <X className="size-4" aria-hidden />
                </button>
            </header>

            {/* --- the read-out: where this shade stands ------------------------------
                Label over value, mono values with tabular figures so a re-solve does not
                make the row breathe. The hex is a copy button rather than text: it is the
                one value here somebody leaves with. */}
            <dl className="insp-facts border-b [&_dt]:text-xs [&_dt]:text-muted-foreground">
                <div>
                    <dt>hex</dt>
                    <dd>
                        <button
                            type="button"
                            className="insp-copy group rounded-sm font-mono text-sm font-medium tabular-nums"
                            onClick={copyHex}
                            title="Copy the hex"
                        >
                            {solved.hex}
                            <Copy
                                className="text-muted-foreground size-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                                aria-hidden
                            />
                        </button>
                    </dd>
                </div>
                <Fact label="lightness" value={solved.L.toFixed(4)} />
                {/* The constraint pair, and only on the rung the constraint actually names —
                    700 for the chromatic families, 800 for grey. Showing it on every dark
                    rung implies a rule that does not exist. */}
                {rung === (isGrey ? 800 : 700) && on(200) !== null && (
                    <Fact
                        label="on its 200"
                        title={`The 4.5 rule: ${label} ${rung} is the shade the palette promises to read on ${label} 200 at 4.5:1 or better.`}
                        value={on(200)!.toFixed(2)}
                        grade={wcagLevel(on(200)!)}
                    />
                )}
                <Fact
                    label="on white"
                    value={onWhite.toFixed(2)}
                    grade={rung >= 600 ? wcagLevel(onWhite) : undefined}
                />
            </dl>

            {/* --- the edit: what it moves, then the colour ---------------------------- */}
            <div className="insp-edit">
                <section className="insp-section" aria-label="What this edit changes">
                    <div className="insp-caption text-muted-foreground text-xs">Editing</div>
                    {isAnchor ? (
                        <>
                            {/* Where the other branch has a switch, this one has a statement,
                                at the same height: an anchor offers no choice of scope, and
                                the card should not change shape to say so. */}
                            <p className="flex h-7 items-center text-sm font-medium">
                                This shade is an anchor — editing it rebuilds the scale
                            </p>
                            <p className="text-muted-foreground mt-1.5 truncate text-xs">
                                All {blastRadius} shades re-derive from it, across every family.
                            </p>
                        </>
                    ) : (
                        <>
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
                                {isGrey ? (
                                    /* Grey's ramp is disabled — and a disabled control swallows
                                       the hover, so a `title` on the button itself never shows.
                                       The explanation goes on a wrapping span, which does
                                       receive the hover (the button inside is
                                       `pointer-events: none`), so the reason it is off is
                                       reachable rather than a dead grey pill. */
                                    <span
                                        title="Grey has no hue to give a ramp — its scale is fixed by its two anchors, not by a hue and chroma, so there is nothing for a whole-ramp edit to change."
                                        className="inline-flex cursor-not-allowed"
                                    >
                                        <SegmentedItem
                                            value="ramp"
                                            className="px-2.5 text-xs"
                                            disabled
                                            tabIndex={-1}
                                        >
                                            The whole grey scale
                                        </SegmentedItem>
                                    </span>
                                ) : (
                                    <SegmentedItem
                                        value="ramp"
                                        className="px-2.5 text-xs"
                                        title={`Give ${label}'s whole ramp this hue and chroma. All ${solution.chromaticRungs.length} shades re-derive; lightness stays on the shared ladder, so ${family}-${rung} lands at ${rampLanding ?? '…'}${rampLanding && rampLanding.toLowerCase() !== draft.toLowerCase() ? ', near your colour rather than on it' : ''}.`}
                                    >
                                        The whole {label} ramp
                                    </SegmentedItem>
                                )}
                                <SegmentedItem
                                    value="shade"
                                    className="px-2.5 text-xs"
                                    title={`Hold this one rung off the ladder, and record why. The other ${solution.rungs.size - 1} shades stay exactly where they are.`}
                                >
                                    This shade only
                                </SegmentedItem>
                            </Segmented>
                            {/* One line, clipped rather than wrapped — the same guard as the
                                status line below, for the same reason. */}
                            <p
                                className="text-muted-foreground mt-2 truncate text-xs"
                                title={consequence ?? undefined}
                            >
                                {consequence}
                            </p>
                        </>
                    )}
                </section>

                <section className="insp-section" aria-label="The colour">
                    {/*
                       The colour, edited three ways on one card: a well, a hex, and the
                       channel sliders — the same editor the Add-a-colour dialog uses, so "edit a
                       shade" and "choose a colour for a new family" cannot offer different
                       channels.

                       The well and the hex ride on the sliders' own header row, left of the
                       space switch, the way a picker lays them out: the value, and the space it
                       is read in, on one line. No caption over the section — a colour well, a
                       hex and three colour tracks do not need a word saying "colour", and the
                       row it would cost is the row the whole card was too tall by.

                       Typing a hex is precise and useless for "a little less green" — the whole
                       reason this panel exists is judging a hue against its neighbours, and
                       that is a nudge, not a value you can name. Each channel commits on every
                       pointer move, so the wall behind the panel re-solves live;
                       `onDragChange` sets the store's `dragging` flag, which is what stops the
                       swatches transitioning and silences the rejection toast for the frames
                       where a constraint refuses.
                    */}
                    <ChannelEditor
                        hex={solved.hex}
                        onChange={write}
                        onDragChange={setDragging}
                        leading={
                            <div className="insp-field">
                                {/* The native picker, dressed as a well: the UA's bevelled
                                    swatch was the one control on the card that did not look
                                    like it belonged to it. `appearance: none` and the swatch
                                    pseudo-elements are in `app.css`, with the other native
                                    controls. */}
                                <input
                                    type="color"
                                    className="insp-well"
                                    aria-label="Pick a colour"
                                    value={/^#[0-9a-f]{6}$/i.test(draft) ? draft : '#000000'}
                                    onChange={(e) => {
                                        setDraft(e.target.value);
                                        commit(e.target.value);
                                    }}
                                />
                                <Input
                                    type="text"
                                    /*
                                       A FIXED width, and it is not cosmetic. shadcn's `Input`
                                       carries `w-full`, which beats any width set in `app.css`
                                       because utilities outrank the components layer — so the
                                       field filled the row and then SHRANK the moment a chip
                                       appeared beside it. One more thing moving while you edit.
                                    */
                                    className="h-8 w-32 shrink-0 font-mono !text-sm tabular-nums"
                                    value={draft}
                                    spellCheck={false}
                                    aria-label="Hex value"
                                    aria-invalid={error ? true : undefined}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onBlur={(e) => commit(e.currentTarget.value)}
                                    onKeyDown={(e) =>
                                        e.key === 'Enter' && commit(e.currentTarget.value)
                                    }
                                />
                                {error && <Chip tone="bad">{error}</Chip>}
                            </div>
                        }
                    />

                    {/*
                       ONE status line, and it always renders — which is the fix to the panel
                       jumping while you drag.

                       Three separate things used to appear and disappear here: the delta
                       sentence (gated on |deltaL| > 0.0002, so it flickered in and out as the
                       slider crossed the threshold), the out-of-gamut warning, and the lightness
                       hint. Each was a row that grew, and near the bottom of the wall this
                       panel is anchored by its BOTTOM edge — `.swatch-pop[data-flip]` — so every
                       one of those moved the whole thing under the cursor.

                       `truncate` is the other half of the guard: the four messages have very
                       different lengths, and clipping rather than wrapping makes the height
                       independent of the wording, so the next message somebody adds here cannot
                       reintroduce the bug. `title` carries the full text either way.
                    */}
                    <p className="insp-delta truncate text-xs font-medium" title={statusLine}>
                        {statusLine}
                    </p>
                </section>
            </div>

            {/* --- the foot: the note, and the one way back ----------------------------
                Off the working area, under a hairline, so neither can be mistaken for part
                of the edit. The undoing action sits right, where a dialog puts the thing you
                do last; it is `outline`, never filled, because the filled button on this
                card would be the one that changes 66 shades. */}
            <footer className="insp-foot border-t">
                {isAnchor ? (
                    <>
                        {/* The consequence sits beside the action that causes it, measured
                            by the trial solve: where the shade lands, what else moves. */}
                        <span
                            className="text-muted-foreground truncate text-xs"
                            title={unhookNote?.full ?? undefined}
                        >
                            {unhookNote?.short}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            disabled={!unhook}
                            onClick={unhookNow}
                            title="This shade stops being an input; what it fed the ladder is kept as a number"
                        >
                            Unhook the anchor
                        </Button>
                    </>
                ) : (
                    <>
                        {/*
                           The note is optional and out of the way until asked for.

                           Most edits do not want a sentence recorded against them, and a
                           permanent empty field said otherwise — it read as a question waiting
                           to be answered. So it is a link now, and the input appears only when
                           there is something to say. A shade that already carries a reason
                           opens straight to it, so nothing an earlier edit recorded is hidden.
                        */}
                        {reasonAsked || reason.trim() !== '' ? (
                            <label className="insp-reason [&_span]:text-xs [&_span]:text-muted-foreground">
                                <span>A note, recorded alongside the value</span>
                                <Input
                                    type="text"
                                    value={reason}
                                    autoFocus={reasonAsked && reason.trim() === ''}
                                    placeholder="why this shade is what it is"
                                    onChange={(e) => setReason(e.target.value)}
                                    onBlur={(e) => override && commit(draft, e.currentTarget.value)}
                                />
                            </label>
                        ) : (
                            <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="h-auto px-0 text-xs"
                                onClick={() => setReasonAsked(true)}
                            >
                                Add a note
                            </Button>
                        )}
                        {override && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="shrink-0"
                                onClick={reset}
                                title="Drop the exception; this shade returns to the ladder"
                            >
                                Reset to the ladder
                            </Button>
                        )}
                    </>
                )}
            </footer>
        </section>
    );
}

/**
 * One read-out cell: a quiet label over a mono value, and a verdict chip where the value is
 * measured against a rule. The chip is the same `Chip` the wall and the audit use, so "AA"
 * looks the same wherever it is said.
 */
function Fact({
    label,
    title,
    value,
    grade,
}: {
    label: string;
    /** The long form of a label kept short so the row stays one line. */
    title?: string;
    value: string;
    grade?: string;
}) {
    return (
        <div>
            <dt title={title} className={title ? 'cursor-help' : undefined}>
                {label}
            </dt>
            <dd className="font-mono text-sm font-medium tabular-nums">
                {value}
                {grade && (
                    <Chip tone={grade === 'fail' ? 'bad' : grade === 'AA-L' ? 'warn' : 'ok'}>
                        {grade}
                    </Chip>
                )}
            </dd>
        </div>
    );
}
