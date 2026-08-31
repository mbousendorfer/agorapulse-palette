/**
 * Nodes for tokens the app invents: added colour families, added rungs, and
 * added semantic tokens.
 *
 * The vendored graph only knows what the design system ships. Anything created
 * here has to exist as a real node or it reaches nothing downstream — not the
 * target picker, not the CSS emit, not the preview, not the exports. Painting
 * the palette wall is the one thing that deliberately bypasses the graph, so a
 * missing node shows up as a functional gap rather than a blank swatch.
 */

import type { PaletteSolution } from '../engine/types';
import { cssVarFromPath } from './cssName';
import { buildGraph } from './graph';
import type { NodeId, TokenGraph, TokenNode } from './types';

/** A semantic token the user created, rather than one the design system ships. */
export interface AddedToken {
    /** Full dot path, e.g. `sys.color.surface.promo`. */
    id: NodeId;
    target: NodeId;
}

function refNode(family: string, rung: number): TokenNode {
    const path = ['ref', 'palette', family, String(rung)];
    return {
        id: path.join('.'),
        path,
        cssVar: cssVarFromPath(path),
        tier: 'ref',
        palette: 'v3',
        // New rungs belong in the file the V3 palette lives in, so the export
        // lands them next to their siblings.
        originFile: 'reference/palette.json',
        source: { kind: 'derived', rung: `${family}.${rung}` },
        editable: false,
        isColor: true,
    };
}

function sysNode(id: NodeId, target: NodeId): TokenNode {
    const path = id.split('.');
    // Route the export by role, matching how the design system splits the files.
    const role = path[2];
    const known = ['surface', 'text', 'icon', 'border', 'link', 'data'];
    return {
        id,
        path,
        cssVar: cssVarFromPath(path),
        tier: 'sys',
        palette: 'v3',
        originFile: known.includes(role)
            ? `system/color-${role}.json`
            : 'system/color-surface.json',
        source: { kind: 'alias', target },
        editable: true,
        isColor: true,
    };
}

/**
 * Rebuild the graph with whatever the spec and the solution imply beyond the
 * vendored snapshot.
 *
 * Returns the base graph unchanged when nothing was added, so the common case
 * costs one comparison and keeps referential identity for memoisation.
 */
export function graphWithAdditions(
    base: TokenGraph,
    solution: PaletteSolution,
    added: AddedToken[],
): TokenGraph {
    const extra: TokenNode[] = [];

    for (const ref of solution.rungs.keys()) {
        const [family, rung] = ref.split('.');
        const id = `ref.palette.${family}.${rung}`;
        if (!base.nodes.has(id)) extra.push(refNode(family, Number(rung)));
    }

    for (const token of added) {
        if (!base.nodes.has(token.id)) extra.push(sysNode(token.id, token.target));
    }

    if (extra.length === 0) return base;

    // Rebuilding is the honest option: the new sys nodes carry alias edges, so
    // the reverse index and the topological order both have to be recomputed.
    // At ~800 nodes this is well under a millisecond, and it happens only when
    // something was actually added.
    // `base.diagnostics`, not `[]`. Passing an empty list meant that the moment a
    // user added one family, every `sys-literal` and `duplicate-css-name` finding
    // from parse time vanished from the audit panel — cycles and dangling aliases
    // get recomputed here, but the parse-time invariants cannot be, so dropping
    // them silently downgraded the app's own integrity report.
    return buildGraph([...base.nodes.values(), ...extra], base.diagnostics);
}

/** Style Dictionary key for a family name typed by a human. */
export function toFamilyId(input: string): string {
    const words = input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter(Boolean);
    if (words.length === 0) return '';
    return (
        words[0] +
        words
            .slice(1)
            .map((w) => w[0].toUpperCase() + w.slice(1))
            .join('')
    );
}
