/**
 * Adding a colour, in a dialog.
 *
 * It used to be a Card that unfolded in place at the end of the wall. That put a form with
 * a name field, a mode switch, a slider, an eight-shade preview and two paragraphs of
 * consequence into the narrow left column of a three-column page, where it had ~460px and
 * wrapped into something unreadable. It is a modal task with a commit and a cancel, so it
 * gets a modal: room for the shades to be full width, and nothing else on screen competing.
 *
 * The shades preview from the first frame, on the default hue, before anything is typed.
 * They used to be gated behind the NAME — `preview` returned null while `id` was empty — so
 * the one thing you are actually choosing was invisible until you had named it, which is
 * backwards. The name gates the commit, not the preview.
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
import { Segmented, SegmentedItem } from './Segmented';
import { ChannelField } from './ChannelField';
import { Chip } from './Chip';

import { contrastHex, hexToOklch, inkOn, normaliseHex } from '../color/oklab';
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
    const [mode, setMode] = useState<'hue' | 'hex'>('hex');
    const [hue, setHue] = useState(320);
    const [hex, setHex] = useState('#C2185B');

    const id = toFamilyId(name);
    const taken = spec.chromatic.families.some((f) => f.id === id);

    /** Hue actually used: given directly, or back-solved from the hex. */
    const effectiveHue = useMemo(() => {
        if (mode === 'hue') return hue;
        try {
            return hexToOklch(normaliseHex(hex)).H;
        } catch {
            return null;
        }
    }, [mode, hue, hex]);

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
            chromaFactor: null,
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
    }, [spec, current, previewId, name, effectiveHue, taken]);

    /** Where a given hex would land on the ladder, and how far off it sits. */
    const hexFit = useMemo(() => {
        if (mode !== 'hex' || !preview || 'error' in preview) return null;
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
    }, [mode, hex, preview, current]);

    const commit = () => {
        if (effectiveHue === null || !id || taken) return;
        updateSpec((d) => {
            d.chromatic.families.push({
                id,
                label: name.trim() || id,
                hue: effectiveHue,
                chromaFactor: null,
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
                    Pick a hue; the eight shades derive themselves on the shared ladder.
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
                            <div className="flex gap-1">
                                {preview.rungs.map((r) => (
                                    <div
                                        key={r.rung}
                                        title={`${r.rung} — ${r.hex}`}
                                        className="font-mono flex flex-1 flex-col justify-between rounded-md p-1.5 text-[10px]/tight"
                                        style={{
                                            height: 72,
                                            background: r.hex,
                                            color: inkOn(r.hex),
                                        }}
                                    >
                                        <span>{r.rung}</span>
                                        <span>{r.hex.replace('#', '')}</span>
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

                <div className="flex flex-col gap-2">
                    <Segmented
                        type="single"
                        size="sm"
                        value={mode}
                        onValueChange={(v) => v && setMode(v as typeof mode)}
                        aria-label="How to give the hue"
                    >
                        <SegmentedItem value="hex" className="px-3 text-xs">
                            From a colour I have
                        </SegmentedItem>
                        <SegmentedItem value="hue" className="px-3 text-xs">
                            From a hue
                        </SegmentedItem>
                    </Segmented>

                    {mode === 'hex' ? (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    aria-label="Target colour"
                                    value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000'}
                                    onChange={(e) => setHex(e.target.value)}
                                    className="h-9 w-11 border-0 bg-transparent p-0"
                                />
                                <Input
                                    type="text"
                                    aria-label="Target colour, as a hex"
                                    value={hex}
                                    onChange={(e) => setHex(e.target.value)}
                                    className="w-32 font-mono"
                                />
                                {effectiveHue !== null && (
                                    <span className="text-muted-foreground text-xs">
                                        hue {effectiveHue.toFixed(1)}°, back-solved from this hex
                                    </span>
                                )}
                            </div>
                            {hexFit && (
                                <p className="text-muted-foreground max-w-prose text-xs">
                                    Its lightness lands nearest rung{' '}
                                    <strong className="text-foreground">{hexFit.rung}</strong>,{' '}
                                    {hexFit.deltaL >= 0 ? '+' : ''}
                                    {hexFit.deltaL.toFixed(4)} L off the ladder (
                                    {(hexFit.stepFraction * 100).toFixed(0)}% of a step). Only the
                                    hue is taken — pin that rung afterwards if you need the exact
                                    colour.
                                </p>
                            )}
                        </div>
                    ) : (
                        /* `ChannelField` rather than a slider and a read-only span. The
                           shade inspector needs the same control three times over, so there is
                           one implementation of the typing behaviour instead of two that
                           drift — see `ChannelField` for why a plainly controlled number input
                           cannot be used here. No `onDragChange`: nothing in this dialog
                           reaches the spec until Add is pressed, so there is no live re-solve
                           to protect. */
                        <ChannelField
                            label="Hue"
                            value={hue}
                            min={0}
                            max={360}
                            step={0.1}
                            decimals={1}
                            unit="°"
                            onChange={setHue}
                        />
                    )}
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
                            <span className="text-muted-foreground font-mono text-[11px]">
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
