/**
 * Adding a colour, in a dialog.
 *
 * It used to be a Card that unfolded in place at the end of the wall. That put a form with
 * a name field, a mode switch, a slider, an eight-shade preview and two paragraphs of
 * consequence into the narrow left column of a three-column page, where it had ~460px and
 * wrapped into something unreadable. It is a modal task with a commit and a cancel, so it
 * gets a modal: room for the shades to be full width, and nothing else on screen competing.
 *
 * The shades preview from the first frame, on the default colour, before anything is typed.
 * They used to be gated behind the NAME — `preview` returned null while `id` was empty — so
 * the one thing you are actually choosing was invisible until you had named it, which is
 * backwards. The name gates the commit, not the preview.
 *
 * ## The same editor the inspector has
 *
 * The colour control here was a two-way switch — "from a colour I have" (a hex box) or "from
 * a hue" (one slider) — and neither half was what you get when you EDIT a shade. So the same
 * intention was expressed two different ways depending on whether the family existed yet,
 * and the dialog could not do the thing the inspector does best: nudge a channel and watch
 * the consequence. It is `ChannelEditor` now, shared with `RungInspector`, which is what
 * stops the two drifting apart again.
 *
 * That parity forced an honesty fix. The hex used to donate only its HUE, and the dialog said
 * so in small print — which would make a chroma slider a control that changes nothing. The
 * colour now gives hue AND chroma exactly as the inspector's "whole ramp" edit does, via the
 * same `deriveChromaFactor` call. Lightness remains the ladder's to give per rung; here it is
 * what the chroma fraction is measured at.
 */

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChannelEditor } from './ChannelEditor';
import { Chip } from './Chip';

import { contrastHex, hexToOklch, inkOn, normaliseHex } from '../color/oklab';
import { deriveChromaFactor } from '../engine/chroma';
import { solvePalette } from '../engine/solve';
import type { PaletteSpec } from '../engine/types';
import { toFamilyId } from '../model/synthetic';
import { useStore } from '../state/store';

/**
 * Stand-in family id, used only to solve the preview before a name exists.
 *
 * The solver keys rungs by `${id}.${rung}`, so previewing needs *an* id. This one is
 * deliberately not a plausible family name, and it never reaches `updateSpec` — `commit`
 * refuses while `id` is empty.
 */
const CANDIDATE = '__candidate';

export function AddFamilyInline() {
    const [open, setOpen] = useState(false);
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="outline"
                    title="Give it a hue or a hex; its shades solve themselves on the shared ladder"
                >
                    <Plus data-icon="inline-start" />
                    Add a colour
                </Button>
            </DialogTrigger>
            {/* Mounted only while open, so the solver in the form does not run on every
                palette edit for a dialog nobody has opened. */}
            {open && <AddFamilyForm onDone={() => setOpen(false)} />}
        </Dialog>
    );
}

function AddFamilyForm({ onDone }: { onDone: () => void }) {
    const spec = useStore((s) => s.spec);
    const updateSpec = useStore((s) => s.updateSpec);
    /**
     * The CURRENT solution, subscribed rather than snapshotted.
     *
     * Both memos below used to read `useStore.getState().solution` and leave it out
     * of their dependency arrays, so editing an anchor while this form was open left
     * the "this hue becomes the binding family — L200 moves X → Y" claim comparing
     * against a solution from before the edit. It recovered by coincidence whenever
     * `spec` happened to change too, which is why it would have survived a refactor.
     */
    const current = useStore((s) => s.solution);

    const [name, setName] = useState('');
    /** One colour, edited any way you like. Where the dialog opens: a mid magenta. */
    const [hex, setHex] = useState('#C2185B');
    /* Whether the last channel move asked for a colour sRGB can hold. `ChannelEditor` reports
       it, because only it knows the requested triple — a hex is always in gamut. */
    const [requestedInGamut, setRequestedInGamut] = useState(true);

    const id = toFamilyId(name);
    const taken = spec.chromatic.families.some((f) => f.id === id);

    /**
     * What the chosen colour donates to the family: its HUE and its CHROMA FRACTION.
     *
     * Hue alone was taken before, and the dialog said so in small print. That made a chroma
     * slider a lie, which is why this changed rather than gaining a caveat: a control on this
     * engine has to be a control. `deriveChromaFactor` is the same call the inspector's "whole
     * ramp" edit makes, so choosing a colour for a NEW family and re-hueing an existing one
     * now mean the same thing.
     *
     * Lightness stays the ladder's to give, per rung — that is what makes a rung number worth
     * writing in a token name. It is not idle, though: the fraction is `C / cmax(L, hue)`, so
     * where you put the lightness decides what "this much chroma" means. All three channels
     * reach the result; only two of them reach it directly.
     */
    const donates = useMemo(() => {
        try {
            const { L, C, H } = hexToOklch(normaliseHex(hex));
            return { hue: H, chromaFactor: deriveChromaFactor(L, C, H) };
        } catch {
            return null;
        }
    }, [hex]);
    const effectiveHue = donates?.hue ?? null;

    /**
     * Solve the whole palette with the candidate family appended.
     *
     * The real solver, not an approximation: a new family participates in the
     * rung-200 search like any other, so adding a very light hue can move the
     * entire ladder. Previewing with anything less would under-report the cost.
     *
     * Keyed on `CANDIDATE` when unnamed, so the shades exist from the first frame.
     * `taken` still blocks it — previewing a duplicate would solve a palette with two
     * families sharing an id, and the second would silently win.
     */
    const previewId = id || CANDIDATE;
    const preview = useMemo(() => {
        if (effectiveHue === null || taken) return null;
        const draft: PaletteSpec = structuredClone(spec);
        draft.chromatic.families.push({
            id: previewId,
            label: name.trim() || 'this colour',
            hue: effectiveHue,
            chromaFactor: donates?.chromaFactor ?? null,
            anchors: {},
        });
        try {
            const solution = solvePalette(draft);
            const rungs = solution.chromaticRungs.map((r) =>
                solution.rungs.get(`${previewId}.${r}`)!,
            );
            const c700on200 = contrastHex(
                solution.rungs.get(`${previewId}.700`)!.hex,
                solution.rungs.get(`${previewId}.200`)!.hex,
            );
            // Did appending this family move the shared ladder? It does when the
            // new hue becomes the binding one for the 4.5 minimum.
            const ladderMoved =
                solution.derived.L200.toFixed(5) !== current.derived.L200.toFixed(5);
            return {
                rungs,
                c700on200,
                witness: solution.derived.rung200Witness,
                ladderMoved,
                newL200: solution.derived.L200,
                oldL200: current.derived.L200,
            };
        } catch (err) {
            return { error: (err as Error).message } as const;
        }
    }, [spec, current, previewId, name, effectiveHue, donates, taken]);

    /** Where a given hex would land on the ladder, and how far off it sits. */
    const hexFit = useMemo(() => {
        if (!preview || 'error' in preview) return null;
        try {
            const target = hexToOklch(normaliseHex(hex));
            const solution = current;
            let best = solution.chromaticRungs[0];
            let bestDelta = Infinity;
            solution.chromaticLadder.forEach((L, i) => {
                const d = Math.abs(L - target.L);
                if (d < bestDelta) {
                    bestDelta = d;
                    best = solution.chromaticRungs[i];
                }
            });
            const step = solution.derived.lowStep;
            return {
                rung: best,
                deltaL: target.L - solution.chromaticLadder[solution.chromaticRungs.indexOf(best)],
                stepFraction: bestDelta / step,
            };
        } catch {
            return null;
        }
    }, [hex, preview, current]);

    const commit = () => {
        if (effectiveHue === null || !id || taken) return;
        updateSpec((d) => {
            d.chromatic.families.push({
                id,
                label: name.trim() || id,
                hue: effectiveHue,
                chromaFactor: donates?.chromaFactor ?? null,
                anchors: {},
            });
        });
        setName('');
        onDone();
    };

    const cssVar = id
        ? `--ref-palette-${id.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}-500`
        : null;

    return (
        <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
                <DialogTitle>Add a colour</DialogTitle>
                <DialogDescription>
                    Choose a colour; the eight shades derive themselves on the shared ladder.
                </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-6">
                {/* The shades first, because they are the thing being chosen. The controls
                    that produce them read as the caption underneath. */}
                {preview && 'error' in preview ? (
                    <p className="text-destructive text-sm">{preview.error}</p>
                ) : (
                    preview && (
                        <div className="flex flex-col gap-3">
                            {/* A PLATE, like the wall: 1px gutters, square corners, a hairline
                                ring per sample. These eight are a ladder — the same object the
                                wall draws — so they are drawn the same way. They were rounded
                                tiles in a 4px gutter, which is the shape the wall stopped
                                using, and two shapes for one idea in one app is what
                                `ColourTile` exists to prevent. */}
                            <div className="flex gap-px">
                                {preview.rungs.map((r) => (
                                    <div
                                        key={r.rung}
                                        title={`${r.rung} — ${r.hex}`}
                                        className="font-mono flex flex-1 flex-col justify-between p-1.5 text-xs/tight shadow-[0_0_0_1px_var(--border)]"
                                        style={{
                                            height: 72,
                                            background: r.hex,
                                            color: inkOn(r.hex),
                                        }}
                                    >
                                        <span>{r.rung}</span>
                                        {/* The hex hides on a narrow screen for the same
                                            reason the wall's does: eight tiles in a ~295px
                                            dialog are about 33px wide, and a six-character
                                            hex at 12px needs roughly 50, so it would clip —
                                            which reads worse than absent. The rung number
                                            identifies the tile; the hex is in the box above. */}
                                        <span className="hidden sm:inline">
                                            {r.hex.replace('#', '')}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-muted-foreground text-xs">700 on 200</span>
                                <Chip tone={preview.c700on200 >= 4.5 ? 'ok' : 'bad'}>
                                    {preview.c700on200.toFixed(2)}{' '}
                                    {preview.c700on200 >= 4.5
                                        ? 'clears the minimum'
                                        : 'BELOW the minimum'}
                                </Chip>
                                {preview.ladderMoved && (
                                    <Chip tone="warn">
                                        binding family — L200 moves {preview.oldL200.toFixed(4)} →{' '}
                                        {preview.newL200.toFixed(4)}, so every family shifts
                                    </Chip>
                                )}
                            </div>
                            <p className="text-muted-foreground max-w-prose text-xs">
                                {preview.ladderMoved
                                    ? `Rung 200 is solved across all families, and ${preview.witness} now binds it. Adding this family re-derives the whole palette.`
                                    : `The shared ladder is unchanged; ${preview.witness} still binds rung 200.`}
                            </p>
                        </div>
                    )
                )}

                <div className="flex flex-col gap-3">
                    {/* The colour, edited the way a shade is edited: a native picker, a hex
                        box, and the inspector's own channel sliders in OKLCH or HSL.

                        This was a two-way `Segmented` — "from a colour I have" gave a hex box,
                        "from a hue" gave a single hue slider — so the same intention was
                        expressed two different ways depending on whether the family existed
                        yet, and the dialog could not do the thing the inspector does best:
                        nudge a channel and watch the consequence. It is the same component
                        now, so the two cannot offer different channels again. */}
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            type="color"
                            aria-label="The colour this family takes its hue and chroma from"
                            value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000'}
                            onChange={(e) => {
                                setHex(e.target.value);
                                setRequestedInGamut(true);
                            }}
                            className="h-9 w-11 border-0 bg-transparent p-0"
                        />
                        <Input
                            type="text"
                            aria-label="The colour, as a hex"
                            value={hex}
                            spellCheck={false}
                            onChange={(e) => {
                                setHex(e.target.value);
                                setRequestedInGamut(true);
                            }}
                            className="w-32 font-mono"
                        />
                        {donates && (
                            <span className="text-muted-foreground text-xs">
                                hue {donates.hue.toFixed(1)}° · chroma{' '}
                                {(donates.chromaFactor * 100).toFixed(0)}% of the gamut at that
                                lightness
                            </span>
                        )}
                    </div>

                    <ChannelEditor
                        hex={hex}
                        onChange={(next, meta) => {
                            setHex(next);
                            setRequestedInGamut(meta.inGamut);
                        }}
                    />

                    {/*
                       ONE status line, always rendered — the inspector's own fix, for the same
                       reason. A row that appears and disappears is a row that resizes the
                       dialog while you are dragging a slider inside it. Only the text changes,
                       in priority order: what is wrong, then where the colour lands.
                    */}
                    <p className="text-muted-foreground max-w-prose text-xs">
                        {!requestedInGamut
                            ? 'Outside sRGB — the hex is the clamped colour, not what the sliders say.'
                            : hexFit
                              ? `The family takes the hue and the chroma; the ladder gives every rung its lightness. Yours lands nearest rung ${hexFit.rung}, ${hexFit.deltaL >= 0 ? '+' : ''}${hexFit.deltaL.toFixed(4)} L off it (${(hexFit.stepFraction * 100).toFixed(0)}% of a step) — pin that rung afterwards if you need this exact colour.`
                              : 'The family takes the hue and the chroma; the ladder gives every rung its lightness.'}
                    </p>
                </div>

                <div className="flex flex-col gap-2">
                    <label className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground shrink-0 text-xs">Name</span>
                        <Input
                            type="text"
                            value={name}
                            placeholder="e.g. Magenta"
                            onChange={(e) => setName(e.target.value)}
                            className="w-48"
                        />
                        {cssVar && (
                            <span className="text-muted-foreground font-mono text-xs">
                                {cssVar}
                            </span>
                        )}
                        {taken && <Chip tone="bad">that family already exists</Chip>}
                    </label>
                </div>
            </div>

            <DialogFooter>
                <Button variant="outline" onClick={onDone}>
                    Cancel
                </Button>
                <Button
                    disabled={!id || taken || effectiveHue === null}
                    onClick={commit}
                    title={!id ? 'Give it a name first' : undefined}
                >
                    Add {name.trim() || 'this colour'}
                </Button>
            </DialogFooter>
        </DialogContent>
    );
}
