/**
 * The Figma variable collections, drawn the way the palette above is drawn.
 *
 * This is what DESIGN says, sitting under what the CSS says. It is read-only and it is not
 * merged into the token graph: the two do not line up, and the ways they fail to line up are
 * the useful part.
 *
 * It reuses the wall's own `.swatch` tile rather than a chip with a dot beside it. The first
 * version used chips, and a chip puts a 12px dot next to a name — you could read the names but
 * you could not see the palette, which is the whole reason to show it. A tile IS the colour, at
 * the size the eye needs to compare two of them.
 *
 * Two layouts, because the collections are shaped differently and pretending otherwise would
 * misrepresent one of them:
 *
 *   · **Reference** is a ladder — families in rows, rungs in aligned columns, exactly like the
 *     wall. Figma's greys run 100…1000 and its chromatics 100…800.
 *   · **System and Component** have no rungs. `surface-interactive-bold-active-hovered` is a
 *     state, not a step, so there is no column for it to line up under. They get the same tile
 *     in a wrapping grid, grouped by the category the name already declares.
 *
 * Measured against the real export: Reference 95 colours none aliased (a reference holds a
 * literal, as it should); System 115 colours ALL aliased; Component 59 colours. The rung scales
 * disagree with the code — Figma runs -200…-1000, the shipped CSS runs -10…-150 — so a tile may
 * name a token this app has never heard of. Those are outlined rather than hidden.
 */

import { useMemo, useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Segmented, SegmentedItem } from './Segmented';

import { buildGroupTree, flattenGroups, groupOf, labelAfterGroup } from '../model/groups';
import type { TokenNode } from '../model/types';
import { useStore } from '../state/store';
import { ColourTile } from './ColourTile';

import FIGMA from '../../vendor/figma-variables.json';
import type { FigmaCollection, FigmaToken } from '../figma/parse';

interface Collected {
    collection: FigmaCollection;
    mode: string;
    tokens: FigmaToken[];
}

const COLLECTIONS = FIGMA.collections as unknown as Collected[];

const LABEL: Record<FigmaCollection, string> = {
    reference: 'Reference',
    system: 'System',
    component: 'Component',
};

/** The short name, with the parts every token in the collection shares removed. */
function shortName(token: FigmaToken): string {
    return token.cssVar.replace(/^--(ref|sys|comp)-/, '').replace(/^color-/, '');
}

/**
 * What the tile shows as its identity — its last name segment.
 *
 * One rule for both layouts, because the row label always carries everything before it: on a
 * ladder that is the family and the segment is the rung (`grey` → `100`), and under the group
 * tree it is the full group and the segment is the leaf (`surface > interactive` → `hovered`).
 * This started as two branches that returned the same expression.
 */
function headOf(token: FigmaToken): string {
    const short = shortName(token);
    return short.split('-').pop() ?? short;
}

/** The trailing rung of a name, or NaN when the name does not end in a number. */
function rungOf(token: FigmaToken): number {
    return Number(shortName(token).split('-').pop());
}

interface Row {
    /**
     * Unique across the whole card.
     *
     * This was `depth|label`, which collides: `active` exists under both `text > interactive`
     * and `surface > interactive` at the same depth. Duplicate React keys made the switch
     * between collections reconcile onto the wrong rows — Reference came back showing 136
     * tiles of System content under a header correctly reporting 95.
     */
    key: string;
    label: string;
    /** Indent depth, so `surface > interactive > bold` reads as the nesting it is. */
    depth: number;
    note: string;
    tokens: FigmaToken[];
    /** Tile labels, parallel to `tokens`. Empty means fall back to the last name segment. */
    heads: string[];
    /** True when every token carries a numeric rung, so the row can align in columns. */
    ladder: boolean;
}

/**
 * Adapt a Figma token to the shape `buildGroupTree` reads.
 *
 * Only `path` and `tier` are consulted, but the whole field set is filled rather than cast from
 * a partial: a future reader of `groupSegments` would get `undefined` instead of a type error.
 */
function asTokenNode(token: FigmaToken): TokenNode {
    const tier =
        token.collection === 'reference' ? 'ref' : token.collection === 'system' ? 'sys' : 'comp';
    return {
        id: token.cssVar,
        path: [tier, ...token.cssVar.replace(/^--(ref|sys|comp)-/, '').split('-')],
        cssVar: token.cssVar,
        tier,
        palette: 'v3',
        originFile: 'figma',
        source: { kind: 'literal', value: token.value ?? '#000000' },
        editable: false,
        isColor: token.type === 'color',
    };
}

/**
 * Split one collection into rows.
 *
 * Reference groups by family and keeps the rung, so `grey-100 … grey-1000` becomes one row of ten
 * aligned tiles.
 *
 * Everything else goes through the app's OWN `buildGroupTree`, so `surface` nests `interactive`,
 * which nests `bold` and `active` — the hierarchy the names already encode, and the same order
 * the group navigator on the semantic screen shows. Writing a second tree here would have been
 * quicker and would have drifted: `CHILD_ORDER` is where the declared ordering lives, and two
 * views of one vocabulary disagreeing is a failure this codebase has already been bitten by.
 */
function rowsOf(collection: Collected): Row[] {
    const colours = collection.tokens.filter((t) => t.type === 'color');

    if (collection.collection !== 'reference') {
        /* Adapted ONCE per token, not once per token per group: this used to run inside the
           filter below, which made it O(groups x tokens) — 28 x 59 adapters for Component. */
        const adapted = colours.map((t) => ({ token: t, node: asTokenNode(t), head: '' }));
        for (const entry of adapted) entry.head = labelAfterGroup(entry.node);

        /* `groupOf`, not the raw path.

           The path and the GROUP path are not the same thing in the component tier:
           `groupSegments` cuts a comp path at its first property segment, so
           `button.primary.orange.surface.default` groups under `button.primary.orange`. Comparing
           a raw `path.slice(1, -1)` against the tree's paths therefore matched almost nothing —
           6 of Component's 59 colours landed in no row at all, and the rows that did appear were
           labelled with the semantic vocabulary because those were the only paths that happened
           to line up. Using the same function the tree was built from is the fix, and the reason
           it is a function in `model/groups` rather than an expression here. */
        const tree = buildGroupTree(adapted.map((a) => a.node));
        const rows: Row[] = [];
        for (const group of flattenGroups(tree)) {
            const direct = adapted.filter((a) => groupOf(a.node) === group.path);
            /*
               An ancestor with no tokens of its own still gets a row.

               Skipping them lost the path: `button > primary > blue` and
               `button > secondary > blue` both rendered as a row labelled `blue` at the same
               indent, because neither `primary` nor `secondary` owns a token directly. Two
               identical labels side by side is worse than one extra heading — the indent is only
               meaningful if the thing it is indented UNDER is on screen.
             */
            if (direct.length === 0) {
                if (group.count === 0) continue;
                rows.push({
                    key: `${collection.collection}|${group.path}`,
                    label: group.label,
                    depth: group.depth,
                    note: `${group.count}`,
                    tokens: [],
                    heads: [],
                    ladder: false,
                });
                continue;
            }
            rows.push({
                key: `${collection.collection}|${group.path}`,
                label: group.label,
                depth: group.depth,
                note: `${direct.length} of ${group.count}`,
                tokens: direct.map((a) => a.token),
                heads: direct.map((a) => a.head),
                ladder: false,
            });
        }
        return rows;
    }

    const byGroup = new Map<string, FigmaToken[]>();
    for (const token of colours) {
        const parts = shortName(token).split('-');
        const group = (/^\d+$/.test(parts[parts.length - 1]) ? parts.slice(0, -1) : parts).join(
            ' ',
        );
        const list = byGroup.get(group);
        if (list) list.push(token);
        else byGroup.set(group, [token]);
    }

    const rows: Row[] = [];
    const singles: FigmaToken[] = [];

    for (const [label, tokens] of byGroup) {
        const ladder = tokens.length > 1 && tokens.every((t) => Number.isFinite(rungOf(t)));
        /* A family of one is not a ladder and does not earn a heading — the social brands and the
           one-off chart hues have no rungs and share no prefix, and 25 headings over one tile each
           is what the chip version got wrong in the other direction. */
        if (tokens.length === 1) {
            singles.push(tokens[0]);
            continue;
        }
        if (ladder) tokens.sort((a, b) => rungOf(a) - rungOf(b));
        rows.push({
            key: `reference|${label}`,
            label,
            depth: 0,
            note: `${tokens.length} rungs`,
            tokens,
            heads: [],
            ladder,
        });
    }

    if (singles.length > 0) {
        rows.push({
            key: 'reference|one-off',
            label: 'one-off',
            depth: 0,
            note: `${singles.length} fixed`,
            tokens: singles,
            heads: [],
            ladder: false,
        });
    }
    return rows;
}

export function FigmaPalettes() {
    const [collection, setCollection] = useState<FigmaCollection>('reference');
    const graph = useStore((s) => s.graph);

    /** Which Figma names the app actually knows, so a gap can be counted rather than claimed. */
    const known = useMemo(() => {
        const set = new Set<string>();
        for (const node of graph.nodes.values()) set.add(node.cssVar);
        return set;
    }, [graph]);

    const current = COLLECTIONS.find((c) => c.collection === collection);
    const rows = useMemo(() => (current ? rowsOf(current) : []), [current]);

    if (!current) return null;

    const colours = current.tokens.filter((t) => t.type === 'color');
    const missing = colours.filter((t) => !known.has(t.cssVar)).length;
    /* The widest ladder decides the column count, so every ladder row in the collection lines up
       under the same rungs — which is the whole point of drawing it as a ladder. */
    const columns = Math.max(1, ...rows.filter((r) => r.ladder).map((r) => r.tokens.length));

    return (
        <Card>
            <CardHeader>
                <CardTitle>What Figma says</CardTitle>
                <CardDescription>
                    The three variable collections as exported, for reference — never merged into
                    the palette above. Run <code className="font-mono">npm run figma</code> after a
                    new export.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {/*
                   The collection switch is gone with the collections it switched between.

                   This was a three-item `Segmented` — reference / system / component — and the
                   export it read now carries the reference collection alone: the other two named
                   771 internal design-system tokens and came out when this repo went public. A
                   one-item segmented control is a button that reports what you are already
                   looking at, so the row is just the count now.

                   `COLLECTIONS` is still an array and `collection` is still state, deliberately:
                   re-vendoring an export with more collections should bring the switch back, not
                   silently show the first one. Hence the guard below rather than an assumption.
                */}
                <div className="flex flex-wrap items-center gap-3">
                    {COLLECTIONS.length > 1 && (
                        <Segmented
                            type="single"
                            size="sm"
                            value={collection}
                            /* The group emits '' when you click the active item; without this
                               guard that would leave no collection selected and an empty card. */
                            onValueChange={(v) => v && setCollection(v as FigmaCollection)}
                        >
                            {COLLECTIONS.map((c) => (
                                <SegmentedItem key={c.collection} value={c.collection}>
                                    {LABEL[c.collection]}
                                </SegmentedItem>
                            ))}
                        </Segmented>
                    )}
                    <span className="text-muted-foreground text-xs">
                        {colours.length} colours · mode {current.mode}
                        {missing > 0 && ` · ${missing} not in the CSS`}
                    </span>
                </div>

                {rows.map((row) => (
                    <div
                        key={row.key}
                        className={`figma-wall${row.ladder ? '' : ' figma-wall-free'}`}
                    >
                        {/* Indented by depth, so the nesting the names encode is the nesting you
                            see: `surface`, then `interactive` under it, then `bold` under that. */}
                        <div
                            className="wall-family text-xs"
                            style={row.depth > 0 ? { paddingLeft: row.depth * 10 } : undefined}
                        >
                            <div className="wall-family-name">{row.label}</div>
                            <div className="text-muted-foreground text-xs">{row.note}</div>
                        </div>
                        <div
                            className={`figma-wall-tiles${row.ladder ? ' figma-wall-ladder' : ''}`}
                            /*
                               Ladder rows declare their COLUMN COUNT so every family lines up
                               under the same rung; free rows let `auto-fill` decide.

                               The count, not the whole template — same reason as the palette
                               wall. An inline `gridTemplateColumns` outranks any stylesheet, so
                               writing the template here made the row unreflowable and no media
                               query could reach it. `app.css` owns the geometry in both layouts.
                            */
                            style={
                                row.ladder
                                    ? { ['--figma-cols' as string]: String(columns) }
                                    : undefined
                            }
                        >
                            {row.tokens.map((token, i) => (
                                <ColourTile
                                    key={token.cssVar}
                                    head={row.heads[i] || headOf(token)}
                                    hex={token.value ?? '#000000'}
                                    absent={!known.has(token.cssVar)}
                                    title={[
                                        token.figmaPath,
                                        token.cssVar,
                                        token.value ?? '',
                                        token.aliasOf ? `\u2192 ${token.aliasOf}` : '',
                                        token.aliasOf && !known.has(token.aliasOf)
                                            ? '(target not in the CSS)'
                                            : '',
                                        known.has(token.cssVar) ? '' : 'not in the CSS',
                                    ]
                                        .filter(Boolean)
                                        .join('\n')}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
