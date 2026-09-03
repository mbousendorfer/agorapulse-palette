/**
 * One screen, because there is one job.
 *
 * `agorapulse-color-lab` puts this behind a six-item rail — Reference, Semantic, Component,
 * Migration, Rules & audit, Diff & export — and five of those six are the migration workbench.
 * With them gone the rail would be a single item pointing at the page you are already on, so
 * the shell is a heading, the page, and a status bar.
 *
 * What survives from that shell, and why each one earned it:
 *
 *   the shared link      a spec encoded into the URL fragment. It is how a palette proposal
 *                        travels without deploying anything, which matters more here than in
 *                        the lab: this tool has no other way to show somebody a result.
 *   the restore notice   a session comes back from localStorage, and a reload that silently
 *                        changes what is on screen is worse than one that loses it.
 *   the unload guard     armed ONLY when the browser has refused to store something. With a
 *                        working session store a reload loses nothing, so an "are you sure?"
 *                        would guard against nothing — the kind users learn to click through.
 *   the status bar       whether the palette still holds. That is the solver talking, and it
 *                        is the one fact you want visible while dragging an anchor.
 */

import { useEffect, useMemo, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import { evaluateConstraints } from './engine/constraints';
import { decodeSpecFromHash } from './export';
import { PaletteWall } from './ui/PaletteWall';
import { Segmented, SegmentedItem } from './ui/Segmented';
import { graph, paletteEditCount, useStore } from './state/store';

export function App() {
    /*
       Load a shared proposal, if the URL carries one.

       A link is an explicit request, so it wins over the restored session — and the restore
       notice is dismissed with it, or it would describe a palette that is no longer on screen.
    */
    useEffect(() => {
        const match = /[#&]s=([^&]+)/.exec(location.hash);
        if (!match) return;
        void decodeSpecFromHash(match[1]).then((payload) => {
            if (!payload) {
                useStore.getState().say('That shared link could not be read');
                return;
            }
            useStore.getState().updateSpec((draft) => {
                Object.assign(draft, payload.spec);
            });
            useStore.getState().dismissRestored();

            /*
               A link can carry SEMANTIC REPOINTS as well as a palette, and this tool cannot
               apply them — repoints are authored in the token table, which belongs to the full
               lab. Saying so is the point of this branch.

               The alternative was to drop them silently, and that is exactly the failure this
               codebase keeps finding in itself: a screen that reports less than it received.
               The palette in the link is still applied in full; only the repoints are not.
            */
            const aliases = payload.aliases.size;
            useStore
                .getState()
                .say(
                    aliases > 0
                        ? `Loaded the shared palette. Its ${aliases} semantic repoint${aliases === 1 ? '' : 's'} need the full lab.`
                        : 'Loaded the shared palette from the link',
                );
        });
    }, []);

    /*
       Undo and redo, on the shortcut everybody already has in their hands.

       Registered on `window` rather than on the wall, because what it undoes is not a wall
       action: an anchor typed into "How this palette is built", a family added in the dialog
       and a slider dragged in the inspector all land in the same one-object spec, so one
       listener at the top is the honest place for it.

       TEXT ENTRY is skipped, and only text entry — which is narrower than the `INPUT|TEXTAREA`
       tag test the wall's `Escape` handler uses, deliberately. In a field you are typing into,
       the browser's own undo is the right behaviour and stealing it would make retyping a hex
       un-take-backable. A RANGE input has no such undo, and it is the single most likely thing
       to hold focus at the moment you want this: you drag the lightness handle, you do not like
       where it went, and your hand is already on the shortcut. Skipping it by tag name meant
       Ctrl+Z did nothing until you clicked somewhere else first — which is how this was found,
       by pressing it after a real drag rather than by reading the guard.

       The same goes for `color`, `checkbox` and the rest: none of them accept typing, so none
       of them has a native undo to protect.
    */
    useEffect(() => {
        const TYPED = /^(text|search|url|email|password|tel|number)$/;
        const onKey = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
            if (e.key.toLowerCase() !== 'z') return;
            const t = e.target as HTMLElement | null;
            const typing =
                t &&
                (t.isContentEditable ||
                    t.tagName === 'TEXTAREA' ||
                    (t.tagName === 'INPUT' && TYPED.test((t as HTMLInputElement).type || 'text')));
            if (typing) return;
            e.preventDefault();
            const { undo, redo, past, future, say } = useStore.getState();
            /*
               Announced, and the announcement is the point rather than politeness.

               An undo here can move up to 49 of the 66 shades at once, and on a wall of
               colour that reads as "something happened" without saying what. It is also the
               only feedback that the stack has run out — a shortcut that silently does
               nothing is indistinguishable from one that is not wired up.
            */
            if (e.shiftKey) {
                if (future.length === 0) return say('Nothing to redo');
                redo();
                say('Redone');
            } else {
                if (past.length === 0) return say('Nothing to undo');
                undo();
                say('Undone');
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const storageBroken = useStore((s) => s.storageBroken);
    useEffect(() => {
        if (!storageBroken) return;
        const guard = (e: BeforeUnloadEvent) => {
            if (paletteEditCount(useStore.getState()) === 0) return;
            e.preventDefault();
        };
        window.addEventListener('beforeunload', guard);
        return () => window.removeEventListener('beforeunload', guard);
    }, [storageBroken]);

    return (
        <div className="shell">
            {/* A fixed top bezel and a fixed bottom read-out, with the bench scrolling between
                them. Both are GRID ROWS of the shell rather than sticky children of the
                scroller, which is the cheaper mechanism and the more honest one: the frame is
                not part of the document being scrolled, so it needs no backdrop trickery, it
                cannot be scrolled past, and it bounds the scroll viewport — which is what stops
                the shade inspector's `scrollIntoView` from parking a panel underneath it. */}
            <Masthead />
            <main className="workspace">
                <RestoreNotice />
                {/* What design says is no longer a second wall underneath this one: the wall
                    itself switches to the Figma export, cell for cell, so the two are compared
                    in place rather than a screen apart. */}
                <PaletteWall />
            </main>
            <StatusBar />
            <Toast />
        </div>
    );
}

/**
 * The bezel: what this is, what the solver is saying, and the light.
 *
 * The header used to be the first item inside the scrolling workspace, carrying the name, the
 * line "Five anchors, 66 shades, solved", and the theme control. Three things were wrong with
 * that and only one of them was visual.
 *
 * The tagline was PROSE STATING A DERIVED FACT — hardcoded "Five" and "66" on the one page
 * whose entire claim is that its numbers are computed. `PaletteWall` had already been through
 * this exact fix internally, counting `anchorCount` from the spec because "'66 shades', 'Five
 * anchors' and 'seven hues' all went stale the moment you used Add a colour". The header was
 * the copy that got missed. It is a live read-out now, so it cannot go stale.
 *
 * The theme control scrolled away, on the app whose whole subject is what a hue looks like
 * against a given ground. Switching ground is a thing you do WHILE looking, so the control has
 * to stay where the looking happens.
 *
 * And a header that scrolls is a page. A frame that does not is an instrument.
 */
function Masthead() {
    return (
        <header className="bezel border-b">
            <div className="bezel-mark">
                <span className="bezel-name text-sm font-semibold">Agorapulse Palette</span>
                <span className="bezel-tick" aria-hidden />
                <SolverReadout />
            </div>
            <ThemeControl />
        </header>
    );
}

/**
 * The solver, out loud.
 *
 * This is `StatusBar`'s `rules` group promoted to the bezel, not copied into it — the bar below
 * no longer carries the constraints. That split is editorial rather than cosmetic: what belongs
 * up here is the state of the PALETTE, which changes under your hands and is the reason to look
 * up; what stays down there is the state of the SESSION and of the vendored token graph, which
 * changes rarely and is reference. This codebase already refuses to state one fact in two
 * places, and moving beats duplicating.
 *
 * The per-field subscription and the memo are carried over from `StatusBar` wholesale, and the
 * reasoning with them, because the cost is unchanged and the failure would be silent:
 * `evaluateConstraints` is ~30 `contrastHex` calls across every family. Subscribing to the
 * whole store (`useStore(s => s)`) re-runs it on every field including `dragging` and `toast`,
 * which during an anchor drag is a second full constraint evaluation per frame on top of the
 * palette solve — for a strip of text that only two fields can change.
 *
 * No `aria-live`. It updates per pointer move while a slider is held, and a live region that
 * fires a few hundred times per gesture is worse than silence. Events get announced by the
 * toast, which is where an announcement belongs.
 */
function SolverReadout() {
    const spec = useStore((s) => s.spec);
    const solution = useStore((s) => s.solution);

    const constraints = useMemo(() => evaluateConstraints(spec, solution), [spec, solution]);
    const violated = constraints.filter((c) => c.status === 'violated').length;
    const binding = constraints.filter((c) => c.status === 'binding').length;

    return (
        <div className="readout">
            <Gauge
                value={solution.rungs.size}
                unit="shades"
                title="Every shade the engine re-derives on each edit"
            />
            {violated > 0 ? (
                <Gauge
                    value={violated}
                    unit={violated === 1 ? 'rule broken' : 'rules broken'}
                    tone="bad"
                    title={`${violated} of the ${constraints.length} rules the palette is seated on no longer hold`}
                />
            ) : (
                <Gauge
                    value={constraints.length}
                    unit="rules hold"
                    title="Every constraint the palette is seated on is satisfied"
                />
            )}
            {/* Only when there is slack to report. A permanent "0 with no slack" is a gauge
                reading zero, which is noise; its absence is the good news. */}
            {binding > 0 && violated === 0 && (
                <Gauge
                    value={binding}
                    unit="with no slack"
                    tone="warn"
                    title={`${binding} of them have zero slack: the next nudge in that direction breaks the palette`}
                />
            )}
        </div>
    );
}

/**
 * One reading: the figure in mono, what it counts in words beside it.
 *
 * Three tones, and they are the house set rather than three hues — the theme has exactly one
 * chromatic token and this app may not invent a second, because every colour in its chrome is a
 * ground somebody is judging a hue against. So: quiet is muted ink, `warn` is FULL-STRENGTH ink
 * (look here), `bad` is the one red stock provides.
 */
function Gauge({
    value,
    unit,
    tone,
    title,
}: {
    value: number;
    unit: string;
    tone?: 'warn' | 'bad';
    title: string;
}) {
    return (
        <span
            className={cn('gauge', tone === 'bad' && 'is-bad', tone === 'warn' && 'is-warn')}
            title={title}
        >
            <b className="gauge-v font-mono">{value}</b>
            <span className="gauge-k">{unit}</span>
        </span>
    );
}

/**
 * A restored session has to announce itself.
 *
 * Without it you cannot tell whether the palette on screen is the one you left or the shipped
 * one, and a saved palette that no longer solves would go back to the baseline without a word.
 * It sits in flow rather than in a toast because it must survive being read.
 */
function RestoreNotice() {
    const restored = useStore((s) => s.restored);
    const dismiss = useStore((s) => s.dismissRestored);
    const resetPalette = useStore((s) => s.resetPalette);
    const [confirming, setConfirming] = useState(false);
    if (!restored) return null;

    return (
        <div
            /* `text-sm`, not `text-xs`. This is prose — two sentences explaining what a
               reload just did to your work — and 12px is the app's scale for dense tabular
               read-outs, not for something you read once and have to understand. The status
               bar beside it stays at 12px because that IS dense data. */
            className="restore-note bg-muted rounded-md border text-sm leading-normal"
            role="status"
        >
            <div>
                <strong>Picked up where you left off.</strong>
                {restored.specChanged && ' Restored your palette.'}
                {restored.paletteDropped && (
                    <>
                        {' '}
                        The saved palette no longer solves against this snapshot, so it went back to
                        the shipped one.
                    </>
                )}
            </div>
            {/*
               `Discard it` confirms, and that is not politeness.

               This was `Start fresh` calling `resetPalette()` on ONE click, sitting immediately
               beside `Got it` in the same button group — so the friendliest word on the notice was
               also its only destructive one, one misclick away from the button you actually want.
               And the thing it discards is the entire work product: this tool authors exactly one
               artefact, so "the palette" and "everything you have done" are the same set.

               The notice has just finished telling you your palette was restored. Throwing it away
               without a question, from that sentence, is the wrong pairing. `Reset palette` on the
               wall above already confirms with a count; this now matches it.
            */}
            <span className="restore-actions">
                {confirming ? (
                    <>
                        <span className="text-muted-foreground">
                            Discard your palette and go back to the shipped one?
                        </span>
                        <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                                resetPalette();
                                setConfirming(false);
                            }}
                        >
                            Discard
                        </Button>
                        <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setConfirming(false)}
                        >
                            Keep
                        </Button>
                    </>
                ) : (
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setConfirming(true)}
                        >
                            Discard it
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={dismiss}
                        >
                            Got it
                        </Button>
                    </>
                )}
            </span>
        </div>
    );
}

function Toast() {
    const toast = useStore((s) => s.toast);
    if (!toast) return null;
    const reject = toast.startsWith('Rejected');
    return (
        <div
            className={cn(
                'toast rounded-full text-xs font-semibold shadow-2xl',
                // The plain toast is a word on an inverted chip; a rejection is prose and
                // wears the destructive fill, so it overrides fill, ink, radius and weight.
                reject
                    ? 'bg-destructive text-destructive-foreground rounded-lg leading-snug font-medium'
                    : 'bg-foreground text-background',
                reject && 'reject',
            )}
            /* A refusal is an ALERT; everything else is a status. `role="status"` is polite —
               a screen reader finishes what it is saying and may never reach it. Right for
               "#7ab6fe copied", which only confirms something you just did; wrong for
               "Rejected: no grey scale satisfies contrast(800, 200) at that anchor", which is
               the only notice that the edit you asked for did not happen. */
            role={reject ? 'alert' : 'status'}
        >
            {toast}
        </div>
    );
}

/**
 * Light, dark, or follow the OS.
 *
 * Three explicit choices rather than a two-state switch, because `system` is not the same
 * request as either — and it is a third option rather than the default: this tool is a
 * background for judging hues, a light chrome biases that judgement, so following the OS is
 * something you ask for. Dark is what a first visit gets.
 */
function ThemeControl() {
    const theme = useStore((s) => s.theme);
    const setTheme = useStore((s) => s.setTheme);

    const MODES = [
        { id: 'light' as const, Icon: Sun, label: 'Light' },
        { id: 'dark' as const, Icon: Moon, label: 'Dark' },
        { id: 'system' as const, Icon: Monitor, label: 'Follow the system' },
    ];

    return (
        <Segmented
            type="single"
            value={theme}
            onValueChange={(v) => v && setTheme(v as typeof theme)}
            aria-label="Theme"
            className="shrink-0"
        >
            {MODES.map(({ id, Icon, label }) => (
                <SegmentedItem key={id} value={id} className="h-7" title={label}>
                    <Icon />
                </SegmentedItem>
            ))}
        </Segmented>
    );
}

/**
 * The bottom read-out: the session, the snapshot, and the edge of the colour space.
 *
 * The `rules` group and the shade count that used to lead this bar are in the bezel now — see
 * `SolverReadout`. What is left is everything that is NOT about the palette you are editing,
 * which turns out to be a coherent set: how the vendored token graph loaded, whether your work
 * is being saved, and where the palette is pressed against sRGB.
 *
 * The gamut count is new here, and it is a fact the app already computed and never showed. Every
 * ladder rung carries `gamutLimited` — the chroma it asked for is outside sRGB, so the value on
 * screen is clamped — and the wall marks each one with a corner notch. The notch answers "is
 * THIS shade clamped"; nothing answered "how much of the palette is against the wall", which is
 * the question you have while turning a chroma knob and watching nothing happen.
 */
function StatusBar() {
    const solution = useStore((s) => s.solution);
    /**
     * Per-field, not `useStore((s) => s)`.
     *
     * Zustand's `set` always produces a new root object, so subscribing to the whole state
     * re-rendered this bar on EVERY change — including `dragging` and `toast`. That mattered
     * most while this bar owned `evaluateConstraints`; the reasoning is now in
     * `SolverReadout`, which inherited both the call and the cost. It still holds here: the
     * gamut tally below walks all 66 rungs, and a bar that re-renders per pointer move would
     * walk them per frame.
     */
    const edits = useStore(paletteEditCount);
    const storageBroken = useStore((s) => s.storageBroken);

    const clamped = useMemo(
        () =>
            [...solution.rungs.values()].filter(
                (r) => r.provenance.kind === 'ladder' && r.provenance.gamutLimited,
            ).length,
        [solution],
    );

    return (
        <div className="statusbar bg-card text-muted-foreground border-t text-xs">
            {/* Two different claims, stated separately — the lab learned this the hard way from
                a bare `✓` that meant "the token graph has no cycles" and read as "this snapshot
                is current". There is no sync in this tool, so only the first is checkable. */}
            <span className="status-group" title="Cycles and dangling aliases in the token graph">
                <span className="status-label">tokens</span>
                {graph.diagnostics.length > 0 ? (
                    <span className="text-destructive">
                        {graph.diagnostics.length} graph issue
                        {graph.diagnostics.length === 1 ? '' : 's'}
                    </span>
                ) : (
                    <span>{graph.nodes.size} loaded, no issues</span>
                )}
            </span>
            <Separator orientation="vertical" className="h-3" />
            <span
                className="status-group"
                title="Rungs whose chroma is limited by the sRGB gamut rather than by the envelope. Turning the chroma knob will not move these."
            >
                <span className="status-label">gamut</span>
                {clamped === 0 ? (
                    <span>all inside sRGB</span>
                ) : (
                    <span>
                        {clamped} of {solution.rungs.size} clamped
                    </span>
                )}
            </span>
            <Separator orientation="vertical" className="h-3" />
            <span className="status-group" title="Departures from the shipped palette">
                <span className="status-label">session</span>
                {edits === 0 ? (
                    <span>nothing changed yet</span>
                ) : (
                    <span className="text-foreground">edited</span>
                )}
                {storageBroken ? (
                    <span
                        className="text-destructive"
                        title="This browser refused to store the session, so a reload will lose it"
                    >
                        · not saved
                    </span>
                ) : (
                    <span title="A reload no longer loses it">· saved</span>
                )}
            </span>
            <span className="status-spacer" />
            {/* The space the whole thing is reasoned in, which is the one piece of standing
                context this bar can carry that is not a live value. */}
            <span
                className="status-note"
                title="The ladder is a ladder in OKLab: equal steps are equal perceptual steps"
            >
                oklch ladder · sRGB output
            </span>
        </div>
    );
}
