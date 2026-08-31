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

import { useEffect, useMemo } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import { evaluateConstraints } from './engine/constraints';
import { decodeSpecFromHash } from './export';
import { FigmaPalettes } from './ui/FigmaPalettes';
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
            <main className="workspace">
                <header className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="text-sm font-semibold">Agorapulse Palette</div>
                        <div className="text-muted-foreground text-[11px]">
                            Five anchors, 66 shades, solved
                        </div>
                    </div>
                    <ThemeControl />
                </header>

                <RestoreNotice />
                <PaletteWall />
                {/* What design says, under what the engine says. A sibling of the wall rather
                    than something inside it: it is not part of solving the palette, it is the
                    reference you check the solution against. */}
                <FigmaPalettes />
            </main>
            <StatusBar />
            <Toast />
        </div>
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
    if (!restored) return null;

    return (
        <div
            className="restore-note bg-muted rounded-md border text-xs leading-normal"
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
            <span className="restore-actions">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={resetPalette}>
                    Start fresh
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={dismiss}>
                    Got it
                </Button>
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
            role="status"
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

function StatusBar() {
    const spec = useStore((s) => s.spec);
    const solution = useStore((s) => s.solution);
    /**
     * Per-field, not `useStore((s) => s)`.
     *
     * Zustand's `set` always produces a new root object, so subscribing to the whole state
     * re-rendered this bar on EVERY change — including `dragging` and `toast` — and each of
     * those renders re-ran `evaluateConstraints`, which is ~30 `contrastHex` calls across every
     * family. During an anchor drag that was a second full constraint evaluation per frame, on
     * top of the palette solve, for a strip of text only two of those fields can change.
     */
    const edits = useStore(paletteEditCount);
    const storageBroken = useStore((s) => s.storageBroken);

    const constraints = useMemo(() => evaluateConstraints(spec, solution), [spec, solution]);
    const violated = constraints.filter((c) => c.status === 'violated').length;
    const binding = constraints.filter((c) => c.status === 'binding').length;
    const ok = constraints.length - violated - binding;

    return (
        <div className="statusbar bg-card text-muted-foreground border-t text-xs">
            {/* "5 ok · 2 binding · 0 violated" named three states and explained none. What you
                need at a glance is whether the palette still holds; `binding` — zero slack, so
                the next nudge breaks it — is the one word that has to carry its own meaning. */}
            <span className="status-group">
                <span className="status-label text-muted-foreground text-xs font-medium">
                    rules
                </span>
                {violated > 0 ? (
                    <span className="text-destructive">{violated} broken</span>
                ) : (
                    <span className="text-primary">all {ok + binding} hold</span>
                )}
                {binding > 0 && (
                    <span
                        className="text-foreground"
                        title={`${binding} of them have zero slack: the next nudge in that direction breaks the palette`}
                    >
                        · {binding} with no slack
                    </span>
                )}
            </span>
            <Separator orientation="vertical" className="h-4" />
            {/* Two different claims, stated separately — the lab learned this the hard way from
                a bare `✓` that meant "the token graph has no cycles" and read as "this snapshot
                is current". There is no sync in this tool, so only the first is checkable. */}
            <span className="status-group" title="Cycles and dangling aliases in the token graph">
                <span className="status-label text-muted-foreground text-xs font-medium">
                    tokens
                </span>
                {graph.diagnostics.length > 0 ? (
                    <span className="text-destructive">
                        {graph.diagnostics.length} graph issue
                        {graph.diagnostics.length === 1 ? '' : 's'}
                    </span>
                ) : (
                    <span>{graph.nodes.size} loaded, no issues</span>
                )}
            </span>
            <Separator orientation="vertical" className="h-4" />
            <span className="status-group" title="Departures from the shipped palette">
                <span className="status-label text-muted-foreground text-xs font-medium">
                    your session
                </span>
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
            <span title="The engine re-derives all 66 shades on every edit">
                {solution.rungs.size} shades solved
            </span>
        </div>
    );
}
