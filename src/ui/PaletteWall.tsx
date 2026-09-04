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
import { Link2, Redo2, Undo2 } from 'lucide-react';

import { ColourTile, SWATCH_FACE, SWATCH_HEAD, SWATCH_HEX } from './ColourTile';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { contrastHex, hexToOklch, prefersDarkInk } from '../color/oklab';
import { countAnchors } from '../engine/anchors';
import { normaliseScopes, scopeSentence, setFamilyScopes } from '../engine/scope';
import { GREY_RUNGS, rungRef } from '../engine/types';
import { FIGMA_MODE, figmaHexOf } from '../figma/reference';
import { ScopeControl } from './ScopeControl';
import { Segmented, SegmentedItem } from './Segmented';
import { cssVarFromPath } from '../model/cssName';
// `graph` is used only by GivenColours, which lists vendored literals. The wall
// itself deliberately does NOT consult it — see rungCssVar below.
import {
    BASELINE_SOLUTION,
    BASELINE_SPEC,
    graph,
    paletteEditCount,
    useStore,
} from '../state/store';
import { encodeSpecToHash, exportFigma } from '../export';
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

    /**
     * Which swatch holds the wall's single tab stop.
     *
     * A roving tabindex, and the reason is measured: the page has 109 focusable elements and
     * 80 of them were in here, so reaching "How this palette is built" from the header cost
     * about eighty presses of Tab. Worse, it exposed a two-dimensional instrument as a flat
     * list — and the gesture this wall exists for is the VERTICAL one, comparing green 600
     * against red 600, which in a flat list is ten presses and in a grid is one ArrowDown.
     *
     * `null` means "the first swatch", so this needs no seeding from the solved palette and
     * cannot point at a rung that a re-solve removed.
     */
    const [tabStop, setTabStop] = useState<string | null>(null);

    useLayoutEffect(() => {
        const el = wallRef.current;
        if (!el) return;
        // Clear first, so a family removed from the spec cannot leave a stale
        // property behind on the element.
        el.removeAttribute('style');
        /*
           The COLUMN COUNT, not the whole template.

           This used to write `gridTemplateColumns` outright, which put the label width, the
           rung minimum and the count in a string here AND in `.wall`'s own rule — the note
           on that rule said as much, "kept in step with the inline value PaletteWall writes
           on mount". Two sources for one number.

           It also made the grid unresponsive by construction: an inline style outranks a
           stylesheet, so no media query could reflow the wall without `!important`. Handing
           CSS the one thing only React knows — how many rungs the widest family has — lets
           `app.css` own the geometry in both layouts, which is what the narrow-screen rule
           below `.wall` now depends on.
        */
        el.style.setProperty('--wall-cols', String(columnCount(solution.chromaticRungs)));
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
        /*
           `pointerdown`, not `mousedown`.

           iOS synthesises `mousedown` from a tap only for elements the engine considers
           clickable, so tapping a blank part of the page to dismiss the inspector was
           unreliable on a phone — and with the panel now a full-width bottom sheet, tapping
           outside it is the main way to close it. `pointerdown` covers mouse, touch and pen
           from one listener, which is also one listener fewer than adding `touchstart`
           beside the old one.
        */
        const onDown = (e: PointerEvent) => {
            const t = e.target as HTMLElement;
            // A click on another swatch is a MOVE, not a dismissal — the button's
            // own handler already changes the selection, and closing here first
            // would make the second click do nothing.
            if (t.closest('.swatch-pop') || t.closest('.swatch')) return;
            selectToken(null);
        };
        window.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onDown);
        return () => {
            window.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onDown);
        };
    }, [selected, selectToken]);

    const chromaticRungs = solution.chromaticRungs;
    const maxColumns = columnCount(chromaticRungs);

    // Anchors across every family, plus whichever of grey's two are still hexes. Counted so
    // the help cannot claim "five" after a sixth is added — or after one is unhooked.
    const anchorCount = countAnchors(spec);

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

    const firstCell = familyRows[0] ? `${familyRows[0].id}.${familyRows[0].rungs[0]}` : null;
    const activeStop = tabStop ?? firstCell;

    /*
       Move within the grid, and move the tab stop with the focus.

       One handler on the container rather than 66 on the buttons — the same reasoning as the
       `Escape` listener above, and it is why the swatches need no key handling of their own.
       The target is found by `data-cell` and focused imperatively: the alternative is holding
       a ref per swatch, which is 66 refs to express "focus the one I just named".

       Rows have different lengths — grey ships ten rungs to the chromatic eight — so a
       vertical move CLAMPS the column instead of wrapping or landing on nothing. Moving down
       from grey 900 lands on the darkest shade the next family has, which is the row's own
       last column and the honest answer to "what is below this".
    */
    const onWallKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
        if (!KEYS.includes(e.key)) return;
        const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
        if (!cell) return;

        const [family, rung] = (cell.dataset.cell ?? '').split('.');
        let row = familyRows.findIndex((r) => r.id === family);
        if (row < 0) return;
        let col = familyRows[row].rungs.indexOf(Number(rung));
        if (col < 0) return;

        const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
        if (e.key === 'ArrowLeft') col = clamp(col - 1, familyRows[row].rungs.length - 1);
        else if (e.key === 'ArrowRight') col = clamp(col + 1, familyRows[row].rungs.length - 1);
        else if (e.key === 'Home') col = 0;
        else if (e.key === 'End') col = familyRows[row].rungs.length - 1;
        else {
            row = clamp(row + (e.key === 'ArrowDown' ? 1 : -1), familyRows.length - 1);
            col = clamp(col, familyRows[row].rungs.length - 1);
        }

        const next = `${familyRows[row].id}.${familyRows[row].rungs[col]}`;
        const el = wallRef.current?.querySelector<HTMLElement>(`[data-cell="${next}"]`);
        if (!el) return;
        // Arrows scroll the page by default, and here they are moving a selection instead.
        e.preventDefault();
        setTabStop(next);
        el.focus();
    };

    return (
        <>
            {/* Every figure below is counted from the spec, not written into the
                prose. "66 shades", "Five anchors", "seven hues" and "Two shades"
                all went stale the moment you used Add a colour — on the one page
                whose whole claim is that its numbers are derived. */}
            <PageHeading
                title="Reference palette"
                /*
                   The ANCHOR count, not the shade count.

                   `${solution.rungs.size} shades, all derived` was here, and the bezel's
                   read-out now says `66 shades` two lines above it — one fact in two places,
                   which is the thing this codebase keeps catching itself doing. The anchors are
                   the other half of the same claim and nothing else on screen states them, so
                   the two together read as the thesis: five hexes in, 66 shades out.

                   Counted, like every other figure on this page, so it cannot say "5" after
                   somebody adds a family.
                */
                tag={`${anchorCount} anchors`}
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
                        <p>
                            A <b>dot</b> in the bottom corner means the shade has been edited in
                            this session: its hex is not the one the design system ships. Hover it
                            to see the shipped value. A family added here has no shipped value to
                            differ from, so it carries none.
                        </p>
                    </>
                }
            />

            <PaletteActions />

            <div
                className={`wall${dragging ? ' dragging' : ''}`}
                ref={attachWall}
                onKeyDown={onWallKeyDown}
                role="group"
                aria-label="Reference palette — arrow keys move between shades"
            >
                {/* No numeric header row: every swatch carries its own rung, so ten more
                    numbers above them would say it twice. What the axis adds is the
                    DIRECTION and the PITCH — a graduation whose ticks come from
                    `--wall-cols`, so it has one tick per column at any number of rungs.

                    `bg-border` is gone from the rule: it was a utility painting the bar
                    solid, and utilities outrank the components layer, so it was silently
                    replacing the graduation `app.css` draws. */}
                <div className="wall-head wall-head-label text-muted-foreground text-xs">
                    lighter → darker
                </div>
                {/* The head of the plate carries two things about the grid under it: the axis
                    (the graduation, ticked per column) and WHAT IS BEING SHOWN (the view
                    switch). The switch lived in the actions bar, beside "Add a colour" — a
                    control that changes what you see, sat among controls that change what you
                    have. It is on the wall now, above the graduation, where the thing it
                    describes begins. */}
                <div className="wall-head wall-head-side">
                    <WallViewSwitch />
                    <div className="wall-head-rule" />
                </div>

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
                        activeStop={activeStop}
                        onStop={setTabStop}
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
    const spec = useStore((s) => s.spec);
    const graphEff = useStore((s) => s.graph);
    const resetPalette = useStore((s) => s.resetPalette);
    const say = useStore((s) => s.say);
    const [confirming, setConfirming] = useState(false);

    // A selector, not `getState()`: a snapshot read outside the reactive system
    // would leave this disabled after the first edit until something else
    // happened to re-render. It returns a number, so there is no identity churn.
    //
    // A count of PALETTES, not of edits: forty slider moves are one authored palette, and
    // "Discard 40 edits?" read as a threat to forty things.
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

    /*
       The shared link, which the app could READ and not write.

       `encodeSpecToHash` has been in `export/index.ts` the whole time, and `App.tsx` decodes
       `#s=` on mount and even explains what a link that carries semantic repoints cannot do
       here. Nothing called the encoder — so the one path the app's own docblock calls "how a
       palette proposal travels, and this tool has no other way to show somebody a result" was
       reachable only by someone who already had a link.

       An empty alias map for the same reason `downloadFigma` passes one: repoints are authored
       in the semantic token table, which is not part of this tool.
    */
    const copyLink = () => {
        void encodeSpecToHash(spec, new Map())
            .then((hash) => {
                const url = `${location.origin}${location.pathname}${location.search}#s=${hash}`;
                /*
                   The address bar is updated as well as the clipboard, and that is not
                   incidental. A link you can see is a link you can copy again by hand if the
                   clipboard is blocked, drag to another window, or bookmark — and it makes the
                   button's effect visible rather than purely reported.

                   `replaceState`, not `location.hash =`: assigning to the hash pushes a
                   history entry, so Back would walk through one entry per copy instead of
                   leaving the page.
                */
                history.replaceState(null, '', url);
                // Confirm AFTER the write resolves — the same fix the hex copy carries. A
                // `void` plus an immediate toast announces a copy a blocked clipboard never
                // performed.
                return navigator.clipboard
                    ?.writeText(url)
                    .then(() => say('Link copied — it carries the whole palette'))
                    .catch(() =>
                        say(
                            'Rejected: the browser blocked the clipboard. The link is in the address bar.',
                        ),
                    );
            })
            .catch(() => say('Rejected: this palette could not be packed into a link'));
    };

    return (
        /*
           A console, not a row of buttons.

           Seven controls of three kinds used to share one line at one weight, with the view
           switch wedged against "Add a colour" — a control that changes what you SEE among
           controls that change what you HAVE. The kinds are named now, each in its own bay
           with a caption above it, and a hairline between bays: what you do to the palette,
           how you take it back, how it leaves the app. The switch is gone from here altogether;
           it sits on the wall's own head, above the graduation, where the thing it describes
           begins.

           No bottom rule under the console. The plate's graduation sits just below and draws the
           boundary; two hairlines that close together read as a mistake.
        */
        <div className="pal-actions" role="toolbar" aria-label="Palette actions">
            <div className="pal-group">
                <span className="pal-group-label text-muted-foreground">palette</span>
                <div className="pal-group-row">
                    <AddFamilyInline />
                    {confirming ? (
                        <span className="pal-confirm text-xs text-muted-foreground">
                            {/* The count, not "every": what you are about to lose is the thing
                                worth stating before you lose it. */}
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
                                    say('Back to the shipped palette');
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

            <div className="pal-group">
                <span className="pal-group-label text-muted-foreground">history</span>
                <div className="pal-group-row">
                    <HistoryControls />
                </div>
            </div>

            <div className="pal-group">
                <span className="pal-group-label text-muted-foreground">share</span>
                <div className="pal-group-row">
                    {/* Sharing and exporting are the two ways a result LEAVES this app, so they
                        sit together, and both are outlined rather than filled for the reason
                        the note below gives. */}
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={copyLink}
                        disabled={!dirty}
                        title={
                            dirty
                                ? 'A link that carries this whole palette — paste it to anybody with the app'
                                : 'Nothing edited yet — a link would carry the palette the design system already ships'
                        }
                    >
                        <Link2 data-icon="inline-start" />
                        Copy link
                    </Button>
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
                </div>
            </div>
        </div>
    );
}

/**
 * What the wall shows: the palette being edited, or what Figma exports for the same cells.
 *
 * On the plate's head rather than in the console, because it is not an action on the palette —
 * it is a statement about the grid directly beneath it, and it belongs where that grid begins.
 * The Figma view is read-only and says so beside the switch, with its count: cells that differ
 * from what you have, counted from the solve so it reports before you flip whether there is
 * anything to see.
 */
function WallViewSwitch() {
    const solution = useStore((s) => s.solution);
    const view = useStore((s) => s.wallView);
    const setWallView = useStore((s) => s.setWallView);

    // Memoised on the solution: ~66 map lookups, re-run only when the palette changes.
    const figmaDiffers = useMemo(() => {
        let n = 0;
        for (const r of solution.rungs.values()) {
            const f = figmaHexOf(r.family, r.rung);
            if (f === undefined || f !== r.hex) n++;
        }
        return n;
    }, [solution]);

    return (
        <div className="wall-view text-xs">
            <span className="text-muted-foreground">
                {view === 'figma'
                    ? `read-only · ${figmaDiffers} of ${solution.rungs.size} differ from your edit`
                    : 'showing'}
            </span>
            <Segmented
                type="single"
                size="sm"
                value={view}
                onValueChange={(v) => v && setWallView(v as typeof view)}
                aria-label="What the wall shows"
            >
                <SegmentedItem
                    value="edit"
                    className="px-2 text-xs"
                    title="The palette you are editing, solved from the spec"
                >
                    Your edit
                </SegmentedItem>
                <SegmentedItem
                    value="figma"
                    className="px-2 text-xs"
                    title={`What Figma exports for the same cells, mode ${FIGMA_MODE}. Read-only — ${figmaDiffers} of ${solution.rungs.size} differ from your edit.`}
                >
                    Figma
                </SegmentedItem>
            </Segmented>
        </div>
    );
}

/**
 * Undo and redo, beside the palette they act on.
 *
 * The shortcut in `App.tsx` is the one people will use; these two are how anybody finds out it
 * exists. A keyboard-only affordance for the app's only recovery path is a feature that is
 * present and undiscoverable.
 *
 * Icons without labels, which is the one place on this page that earns it: undo and redo are
 * the two glyphs every application on the machine draws the same way, so this is external
 * consistency rather than mystery meat. The `title` and `aria-label` carry the word AND the
 * shortcut, because a shortcut nobody is told about might as well not be bound.
 *
 * Ghost, not outlined: they are always present and mostly disabled, and two more outlined
 * boxes beside `Copy link` and `Export for Figma` would read as four peers.
 */
function HistoryControls() {
    const undo = useStore((s) => s.undo);
    const redo = useStore((s) => s.redo);
    // Lengths, not the arrays: a boolean derived here would be recomputed per notification
    // anyway, and a number cannot churn identity the way a sliced array would.
    const canUndo = useStore((s) => s.past.length > 0);
    const canRedo = useStore((s) => s.future.length > 0);
    const say = useStore((s) => s.say);

    /* The modifier the user's own platform prints, so the tooltip is not lying on one of
       them. `userAgent` rather than the deprecated `navigator.platform`, and a miss is
       harmless: the listener binds BOTH meta and ctrl, so a wrong glyph names a key that
       still works. */
    const mod = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';

    return (
        /* Utilities, not a new class in `app.css`: the pair only needs to sit tight against
           each other inside its bay, and a rule for that would be a selector with one
           declaration. `gap-0.5` is what makes two glyphs read as one control. */
        <span className="flex items-center gap-0.5">
            <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={!canUndo}
                onClick={() => {
                    undo();
                    say('Undone');
                }}
                title={canUndo ? `Undo (${mod}Z)` : 'Nothing to undo'}
                aria-label={`Undo (${mod}Z)`}
            >
                <Undo2 />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={!canRedo}
                onClick={() => {
                    redo();
                    say('Redone');
                }}
                title={canRedo ? `Redo (${mod}⇧Z)` : 'Nothing to redo'}
                aria-label={`Redo (${mod}Shift+Z)`}
            >
                <Redo2 />
            </Button>
        </span>
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
    activeStop,
    onStop,
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
    /** `family.rung` of the wall's single tab stop, or null before anything is focused. */
    activeStop: string | null;
    onStop: (cell: string) => void;
}) {
    const updateSpec = useStore((s) => s.updateSpec);
    const selectToken = useStore((s) => s.selectToken);
    const say = useStore((s) => s.say);
    /* In the Figma view the row is a label and its cells: nothing here can be edited, so the
       remove button, the scope pills and the rung stepper all step aside rather than offer
       edits to a palette that is not the one on screen. */
    const editing = useStore((s) => s.wallView) === 'edit';
    /*
       The family's declared scope, selected by REFERENCE — the array on the spec, not a copy —
       so this row does not re-render on every unrelated store update. Normalised at render.
    */
    const scope = useStore((s) =>
        family === 'grey'
            ? s.spec.grey.scope
            : s.spec.chromatic.families.find((f) => f.id === family)?.scope,
    );
    const scopes = normaliseScopes(scope) ?? [];
    const scopeCaption = scopeSentence(scopes);

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
                {/* The ladder note moved from a caption line into the title: the row is 72px,
                    the swatch's height, and the scope control below took the caption's line.
                    The wall's own help says the same thing once, for every row. */}
                <div
                    className="wall-family-name"
                    title={`${label} — ${family === 'grey' ? 'its own ten-rung scale' : 'on the shared lightness ladder'}${scopeCaption ? ` · ${scopeCaption}` : ''}`}
                >
                    {label}
                    {removable && editing && (
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
                {/* What the colour is FOR, declared here where the colour is named. Authored
                    state like the hue, so it goes through `updateSpec` and is one undo step.
                    Stacked: two pills side by side measure ~108px and the label column is
                    104 — a number six comments in `app.css` depend on. */}
                {editing && (
                    <ScopeControl
                        value={scopes}
                        subject={label}
                        // Abreast again on a phone, where the header is a row with room beside
                        // the name. A utility, not an `app.css` rule: that file is
                        // `layer(components)` and `flex-col` here would beat it. 810px is the
                        // wall's own breakpoint.
                        className="wall-family-scope flex-col items-stretch max-[810px]:flex-row max-[810px]:items-center"
                        onChange={(next) => updateSpec((d) => setFamilyScopes(d, family, next))}
                    />
                )}
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
                    label={label}
                    isStop={activeStop === `${family}.${rung}`}
                    onStop={onStop}
                />
            ))}
            {/* The rung control sits in the row it acts on, in the first empty
                cell after its last shade. A global stepper implied the ladder's
                DEPTH was shared; it is not — only its lightness values are, and
                grey has always had ten rungs to the chromatic eight. */}
            {pad > 0 && family !== 'grey' && editing && (
                <div className="swatch empty rung-add bg-transparent">
                    <RungControl family={family} rungs={rungs} />
                </div>
            )}
            {Array.from(
                { length: Math.max(0, pad - (family === 'grey' || !editing ? 0 : 1)) },
                (_, i) => (
                    <div className="swatch empty bg-transparent" key={`pad-${i}`} />
                ),
            )}
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
    label,
    isStop,
    onStop,
}: {
    family: string;
    rung: number;
    selected: string | null;
    onSelect: (id: string | null) => void;
    flip: boolean;
    alignEnd: boolean;
    /** The family's display name — `Electric Blue`, not `electricBlue`. For the spoken name. */
    label: string;
    /** This swatch carries the wall's tab stop. */
    isStop: boolean;
    onStop: (cell: string) => void;
}) {
    const ref = rungRef(family, rung);
    const nodeId = `ref.palette.${ref}`;
    const solved = useStore((s) => s.solution.rungs.get(ref));
    const view = useStore((s) => s.wallView);
    const cssVar = rungCssVar(family, rung);
    /*
       The Figma view: the same cell, painted with what Figma exports for it.

       Read-only by construction — there is no spec behind a Figma value to edit — so the button
       stays (it is a cell in the keyboard grid) but stops opening anything. `null` is a rung
       Figma does not have: an added family, or a rung added at the dark end.
    */
    const figma = view === 'figma' ? (figmaHexOf(family, rung) ?? null) : undefined;
    const shownHex = figma ?? solved?.hex;

    /*
       Bring the panel into the viewport when it opens.

       Measured on a 1280x720 window with a swatch on the second row: the panel is 615px tall
       and opens at y=389, so its bottom lands at 1004 against a workspace that ends at 686.
       318px below the fold — including the three channel sliders and the "Why is it leaving
       the ladder?" field, which is the REQUIRED input for recording an override. Nothing on
       screen said there was more panel down there.

       `block: 'nearest'` because a panel already fully visible must not be scrolled at all:
       the wall is a comparison instrument and moving it under the cursor is the thing every
       other fix in this file is avoiding. The height cap in `app.css` handles the panel that
       is taller than the viewport; this handles the one that merely hangs off the bottom.

       Runs on OPEN only. Re-running on update would move the page mid-drag, which is exactly
       the bug the always-rendered status slot in `RungInspector` was written to kill.

       `behavior: 'auto'` is explicit, and it is not an oversight.

       `smooth` was the first version and it silently did nothing — measured in the browser, the
       identical call moved 384px with the default behaviour and 0px with `smooth`. Moving the
       animation into CSS as `.workspace { scroll-behavior: smooth }` reproduced exactly the
       same failure, which is the useful part: what this call delivers is not decoration, it is
       the panel's sliders and its reason field being reachable at all, so it must not depend on
       an animation any platform is free to decline.

       Stating `auto` rather than leaving it out also pins it against a future
       `scroll-behavior` on an ancestor, which would otherwise silently take it over.

       `block: 'nearest'` moves the minimum distance and the panel's own `pop-in` covers the
       jump — and an instant scroll is what `prefers-reduced-motion` would ask for regardless.
    */
    const popRef = useRef<HTMLDivElement | null>(null);
    const isOpenNow = selected === nodeId;
    useLayoutEffect(() => {
        if (!isOpenNow) return;
        popRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }, [isOpenNow]);

    // Ink chosen by measurement, not by a lightness guess — see `prefersDarkInk`. Measured on
    // the hex actually painted, which in the Figma view is Figma's.
    const meta = useMemo(() => (shownHex ? { light: prefersDarkInk(shownHex) } : null), [shownHex]);

    if (!solved || !meta) return <div className="swatch empty bg-transparent" />;

    if (figma === null) {
        // Figma has no such colour. Said in the cell rather than left blank, because a blank
        // cell in a grid of colours reads as "loading", not as "absent".
        return (
            <div
                className="swatch empty swatch-absent text-muted-foreground bg-transparent text-xs"
                title={`${label} ${rung} is not in the Figma export`}
                aria-label={`${label} ${rung}, not in the Figma export`}
                role="img"
            />
        );
    }

    if (figma !== undefined) {
        /*
           Two hexes, and whether they agree. The dot is the wall's own "this differs" mark,
           pointed the other way: in the edit view it says "not what ships", here it says "not
           what you have". Same corner, same shape, same question — what is different here.
        */
        const differs = figma !== solved.hex;
        const f = hexToOklch(figma);
        const figmaTitle = [
            `${family}-${rung}  ${figma}`,
            `In Figma, mode ${FIGMA_MODE}`,
            `L ${f.L.toFixed(4)}  C ${f.C.toFixed(4)}  h ${f.H.toFixed(1)}`,
            `on white ${contrastHex(figma, '#FFFFFF').toFixed(2)}`,
            differs ? `Your edit has ${solved.hex}.` : 'Same as your edit.',
        ].join('\n');
        return (
            <div className="swatch-cell">
                <button
                    className={cn(SWATCH_FACE, 'readonly', meta.light ? 'light' : 'dark')}
                    style={{
                        ['--swatch' as string]: figma,
                        ['--stagger' as string]: `${Math.abs(rung - 500) / 100}`,
                    }}
                    aria-label={`${label} ${rung}, ${figma}, Figma reference${differs ? `, your edit is ${solved.hex}` : ''}`}
                    data-cell={`${family}.${rung}`}
                    tabIndex={isStop ? 0 : -1}
                    onFocus={() => onStop(`${family}.${rung}`)}
                    title={figmaTitle}
                >
                    <span className={SWATCH_HEAD} aria-hidden>
                        {rung}
                    </span>
                    {differs && <span className="swatch-edited" aria-hidden />}
                    <span className="swatch-foot" aria-hidden>
                        <span className={SWATCH_HEX}>{figma.replace('#', '')}</span>
                    </span>
                </button>
            </div>
        );
    }

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

    /*
       Edited: this shade is not the one the design system ships. Measured in HEX against the
       baseline solve, not inferred from the spec — a moved anchor edits 49 shades that carry no
       mark of their own, and a rung whose anchor was nudged back to where it started is not
       edited at all. A shade with no shipped counterpart (a family added in this session) is
       new rather than edited, and its row already says so.
    */
    const shipped = BASELINE_SOLUTION.rungs.get(ref)?.hex;
    const edited = shipped !== undefined && shipped !== solved.hex;

    const title = [
        `${family}-${rung}  ${solved.hex}`,
        `L ${solved.L.toFixed(4)}  C ${solved.C.toFixed(4)}  h ${solved.H.toFixed(1)}`,
        `on white ${contrastHex(solved.hex, '#FFFFFF').toFixed(2)}`,
        ...(edited ? [`Edited — the design system ships ${shipped}.`] : []),
        p.kind === 'anchor'
            ? 'Anchor: pinned hex that also feeds the derivation.'
            : p.kind === 'override'
              ? `Held off the ladder, ${p.deltaL > 0 ? '+' : ''}${p.deltaL.toFixed(4)} L (${(p.stepFraction * 100).toFixed(0)}% of a step).\n${p.reason}`
              : p.gamutLimited
                ? 'Chroma is limited by the sRGB gamut here, not by the envelope — turning the chroma knob will not move this rung.'
                : 'Derived from the ladder.',
        cssVar,
    ].join('\n');

    /*
       The spoken name, and it was `"100 f9f9fa"` — sixty-six times, with no family in it.

       A button's accessible name comes from its CONTENT, so the five-line `title` above was
       never read: what a screen reader got was the rung and the hex, with nothing to say
       whether this was grey or green. Sixty-six buttons, and no way to tell 600 in one family
       from 600 in another — on the one screen whose entire job is comparing exactly that.

       Built from the same `provenance` that produces the visible mark, so the label cannot
       claim a shade is an anchor after the spec stops saying so. The visible rung and hex go
       `aria-hidden` below, or the name is announced twice over.
    */
    const spokenState =
        p.kind === 'anchor'
            ? 'anchor, the ladder derives from it'
            : p.kind === 'override'
              ? `held off the ladder, ${p.deltaL > 0 ? 'lighter' : 'darker'} by ${Math.abs(p.deltaL).toFixed(3)}`
              : clamped
                ? 'derived, chroma clamped by the sRGB gamut'
                : 'derived from the ladder';
    const spokenName = `${label} ${rung}, ${solved.hex}, ${spokenState}${edited ? `, edited from ${shipped}` : ''}`;

    return (
        <div className="swatch-cell">
            <button
                className={cn(
                    /* The face comes from `ColourTile`, not from a literal here — that literal
                       IS what made the same colour render two different ways in three places.
                       The wall adds behaviour on top; it may not add a different typeface. */
                    SWATCH_FACE,
                    /* No ring utilities here any more. Hover, pressed and focus were
                       `hover:ring-2 ring-foreground` / `aria-pressed:ring-primary
                       aria-pressed:shadow-lg` at this call site, with the stacking and the
                       sample's own edge in `app.css` — two owners of one `box-shadow`, and
                       utilities outrank the components layer, so the utility silently replaced
                       everything the stylesheet set. All three states are in `app.css` now, as
                       one two-tone ladder measured against 66 arbitrary grounds. */
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
                /* `aria-pressed` says "selected"; it does not say "this opens a panel". Both
                   are true of a swatch, and only one of them was announced. */
                aria-expanded={isOpen}
                aria-label={spokenName}
                data-cell={`${family}.${rung}`}
                /* The roving tab stop. `onFocus` rather than only the arrow handler, so a
                   click or a Shift+Tab arriving from below also leaves the stop where the
                   user actually is — otherwise Tab would jump back to the first swatch. */
                tabIndex={isStop ? 0 : -1}
                onFocus={() => onStop(`${family}.${rung}`)}
                onClick={() => onSelect(selected === nodeId ? null : nodeId)}
                title={title}
            >
                {/* The rung number, on every swatch. It was in the header row only,
                so by the seventh family you were counting columns.

                `aria-hidden` on both labels: `aria-label` above already says the family, the
                rung, the hex and the provenance, and without this the rung and hex are read a
                second time with no family attached. */}
                <span className={SWATCH_HEAD} aria-hidden>
                    {rung}
                </span>
                {clamped && <span className="swatch-clamp" aria-hidden />}
                {/* A dot, not a word: the foot already holds a mark and a hex in 36px, and
                    "edited" is a fact about the session rather than about the colour. The
                    title and the spoken name carry the words, and the shipped hex. */}
                {edited && <span className="swatch-edited" aria-hidden />}
                <span className="swatch-foot" aria-hidden>
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
                    ref={popRef}
                    className="swatch-pop rounded-lg border border-input shadow-xl"
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
        /* A bench section, not a Card. See `.bench` in `app.css`: three bordered, rounded,
           elevated boxes stacked in a flex column said "three discrete objects", where this is
           three sections of one document read in order about the plate above them. */
        <section className="bench">
            <span className="bench-index" aria-hidden>
                01
            </span>
            <h2 className="bench-title">Given, not solved</h2>
            <p className="bench-note">
                Fixed values — brand identity and chart hues. No anchor or constraint moves them.
            </p>
            {/* Tiles, not chips.

                These are colours you are meant to LOOK at — brand hues and a ten-series chart
                ramp — and a chip renders them as a 12px dot beside a name, which is enough to read
                the list and not enough to compare the colours. `ColourTile` is the wall's own
                swatch geometry, so this section, the plate above it and the Figma collections
                below it are one visual language instead of three. */}
            <div className="bench-body flex flex-col gap-4">
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
            </div>
        </section>
    );
}
