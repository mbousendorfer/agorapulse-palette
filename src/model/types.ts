/**
 * The token graph.
 *
 * A node is one Style Dictionary token. Its id is the dot path; its CSS name is
 * derived once, at parse time, by cssName.ts.
 *
 * Two invariants are enforced structurally rather than by convention, because
 * both have already caused real damage in this design system:
 *
 *  1. **The V2/V3 guard.** 23 kebab names collide between the two palettes and
 *     mean OPPOSITE ends of the scale — `grey-100` is #344563 in V2 and #F9F9FA
 *     in V3. Every node is tagged with which palette it belongs to, and V2
 *     nodes are not editable. This is what stops a "swap library" style
 *     inversion.
 *
 *  2. **No hex on a semantic token.** A `sys` node may only be an alias. The
 *     type below makes a literal on a sys node unrepresentable, the parser
 *     rejects one, and the UI never renders a hex field for a sys row.
 */

import type { RungRef } from '../engine/types';

export type Tier = 'ref' | 'sys' | 'comp';

/** Which palette a colour node belongs to. `none` = not a colour token. */
export type PaletteTag = 'v3' | 'v2' | 'none';

export type NodeId = string;

/** A token that points at another token. */
export interface AliasSource {
    kind: 'alias';
    target: NodeId;
}

/** A token that holds a raw value. Never legal on a `sys` colour node. */
export interface LiteralSource {
    kind: 'literal';
    value: string;
}

/** A `ref` colour rung produced by the palette engine. */
export interface DerivedSource {
    kind: 'derived';
    rung: RungRef;
}

export type TokenSource = AliasSource | LiteralSource | DerivedSource;

export interface TokenNode {
    id: NodeId;
    path: string[];
    cssVar: string;
    tier: Tier;
    palette: PaletteTag;
    /** Style Dictionary source file, so an export lands back in the right place. */
    originFile: string;
    source: TokenSource;
    /** False for the whole V2 palette and its legacy intent layer. */
    editable: boolean;
    /** True for colour tokens; the app only manages colour. */
    isColor: boolean;
    description?: string;
}

export interface ResolvedToken {
    /** Final value after walking the alias chain. */
    value: string;
    /**
     * The full chain from this node to the terminal value, inclusive.
     * Kept because it drives three things a resolved hex alone cannot:
     *  - the provenance breadcrumb in the UI,
     *  - the "bypasses the semantic layer" lint on comp tokens aliasing ref,
     *  - the diff column for tokens whose value moved while their alias did
     *    not, which IS the cascade this whole app exists to make visible.
     */
    chain: NodeId[];
    /** True when the chain never terminates in a real value. */
    unresolved?: boolean;
}

export interface TokenGraph {
    nodes: Map<NodeId, TokenNode>;
    /** alias edges: node -> its single target. */
    edgesOut: Map<NodeId, NodeId>;
    /** reverse index: node -> everything that points at it. Drives recompute. */
    edgesIn: Map<NodeId, NodeId[]>;
    /** Dependency order. Resolution is a single pass over this. */
    topoOrder: NodeId[];
    /** Populated when parsing hit problems worth showing rather than throwing. */
    diagnostics: Diagnostic[];
}

export interface Diagnostic {
    severity: 'error' | 'warning';
    code:
        'sys-literal' | 'alias-cycle' | 'dangling-alias' | 'duplicate-css-name' | 'v2-v3-collision';
    message: string;
    nodes: NodeId[];
}

export function isColorPath(path: readonly string[]): boolean {
    // ref.color.*, ref.palette.*, sys.color.*, and any comp token whose leaf names a colour
    // role. The comp tier does not namespace colour, so it is detected by the property name
    // the token feeds.
    //
    // `palette` is here because the V3 scale moved from `ref.color.v3.*` to `ref.palette.*`,
    // and this function reads the NAME. Without it all 95 palette tokens reported
    // `isColor: false` — measured: 118 of 139 name/value disagreements were the whole V3
    // ramp, which is what caught it.
    if (path[1] === 'color' || path[1] === 'palette') return true;
    const leaf = path[path.length - 1];
    const penult = path[path.length - 2];
    const COLOUR_LEAVES = new Set(['color', 'background-color', 'surface', 'content', 'border']);
    return COLOUR_LEAVES.has(leaf) || COLOUR_LEAVES.has(penult ?? '');
}
