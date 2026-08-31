/**
 * The palette wall.
 *
 * Every swatch paints with `background: var(--ref-palette-…)`, resolved against
 * a token block scoped to the wall container. So when the palette re-solves we
 * write 66 custom properties on ONE element and the whole wall repaints with
 * zero React renders. Only the hex labels and contrast chips subscribe to state,
 * and during a drag they are the only thing that costs anything.
 *
 * Without that, an anchor drag re-renders ~380 components at 60 Hz and janks.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { ColourTile, SWATCH_FACE, SWATCH_HEAD, SWATCH_HEX } from './ColourTile';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { contrastHex, prefersDarkInk } from '../color/oklab';
import { GREY_RUNGS, rungRef } from '../engine/types';
import { cssVarFromPath } from '../model/cssName';
// `graph` is used only by GivenColours, which lists vendored literals. The wall
// itself deliberately does NOT consult it — see rungCssVar below.
import { BASELINE_SPEC, graph, paletteEditCount, useStore } from '../state/store';
import { exportFigma } from '../export';
import { AddFamilyInline } from './AddFamily';
import { PageHeading } from './PageHelp';
import { EngineRules } from './EngineRules';
import { RungInspector } from './RungInspector';

/**
 * The CSS name a rung paints through.
 *
 * Derived from the rung itself, NOT looked up in the token graph. A family
 * added in this app has no vendored node, so a graph lookup would return
 * nothing, no custom property would be written, and every swatch of the new
 * family would silently fall back to the `#333` in `.swatch`'s background —
 * looking like a rendering bug rather than a missing token.
 */
function rungCssVar(family: string, rung: number): string {
    return cssVarFromPath(['ref', 'palette', family, String(rung)]);
}

/**
 * Column count follows the widest row. Grey has 10 rungs by construction, and
 * the chromatic ladder can be extended at the dark end, so this cannot be a
 * constant — with a fixed 10 an added rung would silently fall off the wall.
 */
function columnCount(chromaticRungs: number[]): number {
    return Math.max(GREY_RUNGS.length, chromaticRungs.length);
}

export function PaletteWall() {
    const solution = useStore((s) => s.solution);
    const spec = useStore((s) => s.spec);
    const revision = useStore((s) => s.revision);
    const dragging = useStore((s) => s.dragging);
    const selected = useStore((s) => s.selectedToken);
    const selectToken = useStore((s) => s.selectToken);

    // Push the palette into the wall's own scope: one write, and the whole wall
    // repaints with zero React renders.
    //
    // useLayoutEffect, not useEffect: with useEffect there is one frame after
    // mount where the properties are unset and every swatch paints its fallback.
    //
    // The node's ARRIVAL is a dependency, not just the data. That is not stylistic, and
    // it is kept even though the sequence that exposed it is gone.
    //
    // With `[solution, revision]` alone: if the wall unmounts, an edit lands while it is
    // away — the effect runs, finds no element, returns, and its deps count as satisfied
    // — and then a NEW node mounts with no reason to run again. All 66 properties
    // missing, every swatch falling back to the `#333` in `.swatch`. It looked like a
    // half-painted grid rather than a missing write. The wall no longer unmounts (the
    // curve view it swapped with is deleted), so this is now insurance rather than a
    // live fix; it costs one state field and it stops the bug coming back with the next
    // thing that mounts beside it.
    //
    // `wallGeneration` bumps whenever the callback ref fires, so mounting a fresh node
    // re-runs the write. The node itself stays in a ref: it is a mutation target, and
    // holding it in state instead makes `react-hooks/immutability` — correctly — object
    // to writing onto a state value.
    const wallRef = useRef<HTMLDivElement | null>(null);
    const [wallGeneration, setWallGeneration] = useState(0);
    const attachWall = useCallback((el: HTMLDivElement | null) => {
        wallRef.current = el;
        setWallGeneration((n) => n + 1);
    }, []);

    useLayoutEffect(() => {
        const el = wallRef.current;
        if (!el) return;
        // Clear first, so a family removed from the spec cannot leave a stale
        // property behind on the element.
        el.removeAttribute('style');
        // 104 + 10×46 + gaps = 604px. At 1280 with the default layout the workspace
        // offers 620, so the wall FITS — it used to want 676 against 540 and put a
        // horizontal scrollbar under the app's home screen, hiding grey's 900 and
        // 1000 behind it out of the box.
        el.style.gridTemplateColumns = `104px repeat(${columnCount(solution.chromaticRungs)}, minmax(46px, 1fr))`;
        for (const [ref, solved] of solution.rungs) {
            const [family, rung] = ref.split('.');
            el.style.setProperty(rungCssVar(family, Number(rung)), solved.hex);
        }
    }, [wallGeneration, solution, revision]);

    // One listener on the wall, not one per swatch: 66 of them would each install
    // their own, and only ever one is open.
    useEffect(() => {
        if (!selected) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            const t = e.target as HTMLElement | null;
            if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
            selectToken(null);
        };
        const onDown = (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            // A click on another swatch is a MOVE, not a dismissal — the button's
            // own handler already changes the selection, and closing here first
            // would make the second click do nothing.
            if (t.closest('.swatch-pop') || t.closest('.swatch')) return;
            selectToken(null);
        };
        window.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onDown);
        return () => {
            window.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onDown);
        };
    }, [selected, selectToken]);

    const chromaticRungs = solution.chromaticRungs;
    const maxColumns = columnCount(chromaticRungs);

    // Anchors across every family, plus grey's two. Counted so the help cannot
    // claim "five" after a sixth is added.
    const anchorCount =
        spec.chromatic.families.reduce((n, f) => n + Object.keys(f.anchors).length, 0) + 2;

    // Families come from the spec, so a family added in the modal appears here
    // without a code change.
    const familyRows = [
        { id: 'grey', label: 'Grey', rungs: [...GREY_RUNGS] as number[] },
        ...spec.chromatic.families.map((f) => ({
            id: f.id,
            label: f.label,
            rungs: chromaticRungs,
        })),
    ];

    return (
        <>
            {/* Every figure below is counted from the spec, not written into the
                prose. "66 shades", "Five anchors", "seven hues" and "Two shades"
                all went stale the moment you used Add a colour — on the one page
                whose whole claim is that its numbers are derived. */}
            <PageHeading
                title="Reference palette"
                tag={`${solution.rungs.size} shades, all derived`}
                helpLabel="Why these shades are solved rather than chosen"
                lede={
                    <>
                        Every shade is <em>solved</em>, not picked. Click one to see what produced
                        it.
                    </>
                }
                help={
                    <>
                        <p>
                            {anchorCount} shades are <b>anchors</b>: fixed hexes that the rest is
                            derived from. Everything else falls out of a lightness ladder shared by
                            all {spec.chromatic.families.length} hues, so the same rung means the
                            same lightness in every colour — that is what makes a rung number worth
                            writing in a token name.
                        </p>
                        <p>
                            {spec.overrides.length} shade
                            {spec.overrides.length === 1 ? ' is' : 's are'}{' '}
                            <b>held off the ladder</b>: deliberate exceptions, marked with their ±L
                            and recorded in the spec, with the reason. Nothing else is hand-placed.
                        </p>
                        <p>
                            A <b>notched corner</b> means the chroma is against the edge of sRGB
                            there. Turning the chroma knob will not move that shade — the space has
                            run out, not the rule.
                        </p>
                    </>
                }
            />

            <PaletteActions />

            <div className={`wall${dragging ? ' dragging' : ''}`} ref={attachWall}>
                {/* No numeric header row: every swatch now carries its own rung,
                        so ten more numbers above them said nothing twice. */}
                <div className="wall-head wall-head-label text-muted-foreground font-sans text-xs tracking-wide">
                    lighter → darker
                </div>
                <div className="wall-head wall-head-rule bg-border text-xs" />

                {familyRows.map((row) => (
                    <FamilyRow
                        key={row.id}
                        family={row.id}
                        label={row.label}
                        rungs={row.rungs}
                        maxColumns={maxColumns}
                        selected={selected}
                        onSelect={selectToken}
                        removable={!BASELINE_FAMILIES.has(row.id) && row.id !== 'grey'}
                        // Open upward on the last two rows so the panel does not
                        // hang off the bottom of a wall that fits on one screen.
                        flip={familyRows.length - familyRows.indexOf(row) <= 2}
                        columns={maxColumns}
                    />
                ))}
            </div>

            {/* The rules that produced the wall above, on the same page. Editing
                an anchor and seeing the result was two screens apart before,
                which made a continuous action feel like a round trip. */}
            <EngineRules />

            <GivenColours />
        </>
    );
}

/** Families the design system ships. Anything else was added in this session. */
const BASELINE_FAMILIES = new Set(BASELINE_SPEC.chromatic.families.map((f) => f.id));

/**
 * What you can do TO the palette, above it.
 *
 * Adding a colour used to sit under the wall, below the fold on most screens,
 * which read as an appendix rather than as an action on the thing above it. And
 * two things had no affordance at all: getting back to the shipped palette, and
 * taking the result to Figma without going through another workspace.
 */
function PaletteActions() {
    const solution = useStore((s) => s.solution);
    const graphEff = useStore((s) => s.graph);
    const resetPalette = useStore((s) => s.resetPalette);
    const say = useStore((s) => s.say);
    const [confirming, setConfirming] = useState(false);

    // A selector, not `getState()`: a snapshot read outside the reactive system
    // would leave this disabled after the first edit until something else
    // happened to re-render. It returns a number, so there is no identity churn.
    //
    // The PALETTE count, not the session count: this button does not touch the
    // migration plan, so counting decisions here would overstate what it discards.
    const edits = useStore(paletteEditCount);
    const dirty = edits > 0;

    const downloadFigma = () => {
        /*
           An empty alias map, and that is a statement rather than a placeholder.

           `exportFigma` takes semantic repoints so a payload can carry "this role now points
           at that shade". Repoints are authored in the semantic token table, which is not part
           of this tool — so there are none to pass. See the note on the shared link in
           `App.tsx`: a link made by the full lab CAN carry repoints, and the restore notice
           says so rather than dropping them silently.
        */
        const payload = exportFigma(graphEff, solution, new Map());
        const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'figma-variables.json';
        a.click();
        URL.revokeObjectURL(url);
        say('figma-variables.json downloaded');
    };

    return (
        <div className="pal-actions border-b">
            <div className="pal-actions-left">
                <AddFamilyInline />
            </div>
            <div className="pal-actions-right text-muted-foreground">
                {/* Outlined, not filled, and on this screen that is not a taste call. The
                    theme's primary is a saturated #f54900 and this page exists to judge 66
                    hues against a neutral ground; a solid orange button was the loudest
                    thing on it, louder than the palette. Export is a utility here — the
                    screen's real work is moving anchors. */}
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={downloadFigma}
                    title="The whole palette as a Figma variables payload, ready for the plugin"
                >
                    Export for Figma
                </Button>
                {confirming ? (
                    <span className="pal-confirm text-xs text-muted-foreground">
                        {/* The count, not "every": what you are about to lose is
                            the thing worth stating before you lose it. */}
                        <span>
                            Discard {edits} edit{edits === 1 ? '' : 's'}?
                        </span>
                        <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                                resetPalette();
                                setConfirming(false);
                                say(
                                    'Back to the shipped palette — the migration plan is untouched',
                                );
                            }}
                        >
                            Reset
                        </Button>
                        <Button
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setConfirming(false)}
                        >
                            Keep
                        </Button>
                    </span>
                ) : (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={!dirty}
                        onClick={() => setConfirming(true)}
                        title={
                            dirty
                                ? 'Back to the palette the design system ships'
                                : 'Nothing edited yet'
                        }
                    >
                        Reset palette
                    </Button>
                )}
            </div>
        </div>
    );
}

function FamilyRow({
    family,
    label,
    rungs,
    maxColumns,
    selected,
    onSelect,
    removable,
    flip,
    columns,
}: {
    family: string;
    label: string;
    rungs: readonly number[];
    maxColumns: number;
    selected: string | null;
    onSelect: (id: string | null) => void;
    /** Added in this session, so removing it cannot dangle a shipped token. */
    removable: boolean;
    /** Open the editor upward: this row is near the bottom of the wall. */
    flip: boolean;
    columns: number;
}) {
    const updateSpec = useStore((s) => s.updateSpec);
    const selectToken = useStore((s) => s.selectToken);
    const say = useStore((s) => s.say);

    const remove = () => {
        // Drop its overrides too, or the spec keeps exceptions pinned to rungs
        // that no longer exist and the constraint report reads as broken.
        updateSpec((d) => {
            d.chromatic.families = d.chromatic.families.filter((f) => f.id !== family);
            d.overrides = d.overrides.filter((o) => !o.rung.startsWith(`${family}.`));
        });
        if (selected?.startsWith(`ref.palette.${family}.`)) selectToken(null);
        say(`Removed ${label}`);
    };
    // Grey has 10 rungs, the chromatic families 8 — the two extra columns of a
    // chromatic row stay empty rather than stretching, so rung numbers stay
    // aligned down the wall.
    const cells = [...rungs];
    const pad = maxColumns - cells.length;

    return (
        <>
            <div className="wall-family text-muted-foreground text-xs">
                <div className="wall-family-name">
                    {label}
                    {removable && (
                        <button
                            className="wall-family-remove text-xs text-muted-foreground hover:text-destructive leading-none"
                            onClick={remove}
                            title={`Remove ${label} — added in this session`}
                            aria-label={`Remove ${label}`}
                        >
                            ✕
                        </button>
                    )}
                </div>
                <div className="text-muted-foreground text-xs">
                    {family === 'grey' ? 'independent scale' : 'shared ladder'}
                </div>
            </div>
            {cells.map((rung, i) => (
                <Swatch
                    key={rung}
                    family={family}
                    rung={rung}
                    selected={selected}
                    onSelect={onSelect}
                    flip={flip}
                    // Anchor to the right edge in the right-hand half, or the
                    // panel runs off the workspace on the darkest rungs.
                    alignEnd={i > columns / 2}
                />
            ))}
            {/* The rung control sits in the row it acts on, in the first empty
                cell after its last shade. A global stepper implied the ladder's
                DEPTH was shared; it is not — only its lightness values are, and
                grey has always had ten rungs to the chromatic eight. */}
            {pad > 0 && family !== 'grey' && (
                <div className="swatch empty rung-add bg-transparent">
                    <RungControl family={family} rungs={rungs} />
                </div>
            )}
            {Array.from({ length: Math.max(0, pad - (family === 'grey' ? 0 : 1)) }, (_, i) => (
                <div className="swatch empty bg-transparent" key={`pad-${i}`} />
            ))}
        </>
    );
}

/**
 * Add or drop the darkest rung of ONE family.
 *
 * The dark end is the only place a rung can go: inserting one between 500 and 700
 * lifts rung 700 to L 0.5702, where green-700 on green-200 falls to 3.66 and
 * breaks the contrast constraint the whole ladder is seated on. That interval is
 * exactly where intermediate hover states would want to live, so it is the one
 * addition the rules forbid — stated here rather than left to a control that
 * silently refuses.
 */
function RungControl({ family, rungs }: { family: string; rungs: readonly number[] }) {
    const spec = useStore((s) => s.spec);
    const updateSpec = useStore((s) => s.updateSpec);

    const count = rungs.length;
    // Ten: grey's depth, and the widest the wall can stay column-aligned at.
    const MAX = 10;
    const extra = Math.max(
        0,
        Math.floor(
            spec.chromatic.families.find((f) => f.id === family)?.extraDarkRungs ??
                spec.chromatic.extraDarkRungs ??
                0,
        ),
    );

    const set = (n: number) =>
        updateSpec((d) => {
            const f = d.chromatic.families.find((x) => x.id === family);
            if (f) f.extraDarkRungs = Math.max(0, Math.min(MAX - 8, n));
        });

    return (
        <div className="rung-ctl">
            {extra > 0 && (
                <button
                    className="rung-btn rounded-sm border border-input border-dashed text-muted-foreground hover:border-primary hover:text-primary font-semibold text-sm leading-none font-mono"
                    onClick={() => set(extra - 1)}
                    title={`Drop ${family}-${700 + extra * 100 + 100}`}
                    aria-label={`Remove the darkest rung of ${family}`}
                >
                    −
                </button>
            )}
            {count < MAX && (
                <button
                    className="rung-btn add rounded-sm border border-input border-dashed text-muted-foreground hover:border-primary hover:text-primary font-semibold text-sm leading-none font-mono"
                    onClick={() => set(extra + 1)}
                    title={`Add ${family}-${count * 100 + 100} — this family only`}
                    aria-label={`Add a rung to ${family}`}
                >
                    +
                </button>
            )}
        </div>
    );
}

function Swatch({
    family,
    rung,
    selected,
    onSelect,
    flip,
    alignEnd,
}: {
    family: string;
    rung: number;
    selected: string | null;
    onSelect: (id: string | null) => void;
    flip: boolean;
    alignEnd: boolean;
}) {
    const ref = rungRef(family, rung);
    const nodeId = `ref.palette.${ref}`;
    const solved = useStore((s) => s.solution.rungs.get(ref));
    const cssVar = rungCssVar(family, rung);

    // Ink chosen by measurement, not by a lightness guess — see `prefersDarkInk`.
    const meta = useMemo(() => (solved ? { light: prefersDarkInk(solved.hex) } : null), [solved]);

    if (!solved || !meta) return <div className="swatch empty bg-transparent" />;
    const isOpen = selected === nodeId;

    const p = solved.provenance;
    // Words, not glyphs. `⚲` and a bare `+0.0104` were the two things on this
    // screen nobody could read without being told, and both name something you
    // need while choosing: this rung is an input, that one is off the ladder.
    const mark =
        p.kind === 'anchor'
            ? 'anchor'
            : p.kind === 'override'
              ? `${p.deltaL > 0 ? '+' : '−'}${Math.abs(p.deltaL).toFixed(3)} L`
              : '';
    // A clamped chroma is not a decision, it is the edge of sRGB — 15 of the 66
    // rungs sit on it. As a labelled pill it shouted over the colours it was
    // annotating; as a machined corner it waits to be asked.
    const clamped = p.kind === 'ladder' && p.gamutLimited;

    const title = [
        `${family}-${rung}  ${solved.hex}`,
        `L ${solved.L.toFixed(4)}  C ${solved.C.toFixed(4)}  h ${solved.H.toFixed(1)}`,
        `on white ${contrastHex(solved.hex, '#FFFFFF').toFixed(2)}`,
        p.kind === 'anchor'
            ? 'Anchor: pinned hex that also feeds the derivation.'
            : p.kind === 'override'
              ? `Held off the ladder, ${p.deltaL > 0 ? '+' : ''}${p.deltaL.toFixed(4)} L (${(p.stepFraction * 100).toFixed(0)}% of a step).\n${p.reason}`
              : p.gamutLimited
                ? 'Chroma is limited by the sRGB gamut here, not by the envelope — turning the chroma knob will not move this rung.'
                : 'Derived from the ladder.',
        cssVar,
    ].join('\n');

    return (
        <div className="swatch-cell">
            <button
                className={cn(
                    /* The face comes from `ColourTile`, not from a literal here — that literal
                       IS what made the same colour render two different ways in three places.
                       The wall adds behaviour on top; it may not add a different typeface. */
                    SWATCH_FACE,
                    // The ring is drawn outside the box, so `.swatch`'s z-index carries it
                    // over the neighbouring cell rather than under it.
                    'hover:ring-foreground hover:ring-2',
                    'aria-pressed:ring-primary aria-pressed:ring-2 aria-pressed:shadow-lg',
                    meta.light ? 'light' : 'dark',
                )}
                style={{
                    ['--swatch' as string]: `var(${cssVar})`,
                    // Distance from the middle of the ladder, so a re-solve settles
                    // outward from where the anchors sit instead of snapping as one
                    // block. It expresses the order of consequence, not of compute.
                    ['--stagger' as string]: `${Math.abs(rung - 500) / 100}`,
                }}
                aria-pressed={selected === nodeId}
                onClick={() => onSelect(selected === nodeId ? null : nodeId)}
                title={title}
            >
                {/* The rung number, on every swatch. It was in the header row only,
                so by the seventh family you were counting columns. */}
                <span className={SWATCH_HEAD}>{rung}</span>
                {clamped && <span className="swatch-clamp" aria-hidden />}
                <span className="swatch-foot">
                    {mark && <span className="swatch-mark rounded-sm tracking-wide">{mark}</span>}
                    <span className={SWATCH_HEX}>{solved.hex.replace('#', '')}</span>
                </span>
            </button>
            {/* Anchored to the swatch, and outside the flow: the wall is a comparison
            instrument, so editing green 600 must not move red 600. Inserting the
            editor as a grid row moved every family below it; opening it above the
            wall moved all of them. This moves nothing. */}
            {isOpen && (
                <div
                    className="swatch-pop rounded-lg border border-input shadow-xl [&>.inspector]:border-0 [&>.inspector]:bg-transparent [&>.inspector]:shadow-none"
                    data-flip={flip ? '' : undefined}
                    data-end={alignEnd ? '' : undefined}
                    onClick={(e) => e.stopPropagation()}
                >
                    <RungInspector family={family} rung={rung} />
                </div>
            )}
        </div>
    );
}

/**
 * The colours the engine does NOT own.
 *
 * White, the overlay, the ten chart hues and the thirteen social brand colours
 * are given, not solved. They live in a separate tray so they can never be read
 * as ladder output — and so nobody looks for a rung that explains them.
 */
function GivenColours() {
    const resolved = useStore((s) => s.resolved);

    const groups = useMemo(() => {
        const out: Array<{ label: string; note?: string; items: Array<[string, string]> }> = [];
        const pick = (prefix: string) =>
            [...graph.nodes.values()]
                .filter((n) => n.id.startsWith(prefix))
                .map(
                    (n) =>
                        [n.id.split('.').slice(3).join('.'), resolved.get(n.id)?.value ?? ''] as [
                            string,
                            string,
                        ],
                )
                .filter(([, v]) => /^#|^rgba?\(/.test(v));

        out.push({ label: 'Chart series', items: pick('ref.palette.data.') });
        out.push({ label: 'Social brand', items: pick('ref.palette.social.') });
        out.push({
            label: 'MermAId (AI surfaces only)',
            note: 'Mirrored from V2 with V2 rung names (.10, .20) inside the V3 namespace — it was never re-stepped.',
            items: pick('ref.palette.mermaid.'),
        });
        return out.filter((g) => g.items.length);
    }, [resolved]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Given, not solved</CardTitle>
                <CardDescription>
                    Fixed values — brand identity and chart hues. No anchor or constraint moves
                    them.
                </CardDescription>
            </CardHeader>
            {/* Tiles, not chips.

                These are colours you are meant to LOOK at — brand hues and a ten-series chart
                ramp — and a chip renders them as a 12px dot beside a name, which is enough to read
                the list and not enough to compare the colours. `ColourTile` is the wall's own
                swatch geometry, so this card, the wall above it and the Figma collections below it
                are now one visual language instead of three. */}
            <CardContent className="flex flex-col gap-4">
                {groups.map((g) => (
                    <div key={g.label} className="flex flex-col gap-1.5">
                        <div className="figma-wall figma-wall-free">
                            <div className="wall-family text-xs">
                                <div className="wall-family-name">{g.label}</div>
                                <div className="text-muted-foreground text-xs">
                                    {g.items.length} fixed
                                </div>
                            </div>
                            <div className="figma-wall-tiles">
                                {g.items.map(([name, value]) => (
                                    <ColourTile
                                        key={name}
                                        /* The group is on the row label, so the tile shows the
                                           leaf — `cyan.100` rather than `data.cyan.100` ten
                                           times over. */
                                        head={name.split('.').slice(1).join('.') || name}
                                        hex={value}
                                        title={`${name} — ${value}`}
                                    />
                                ))}
                            </div>
                        </div>
                        {/* Kept inside its own group. Only MermAId carries one, and it explains
                            why that group's rungs are named .10/.20 — attached anywhere else it
                            would be a claim about the wrong colours. */}
                        {g.note && <div className="text-muted-foreground text-xs">{g.note}</div>}
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
