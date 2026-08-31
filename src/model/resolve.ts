/**
 * Resolve every token to a final value, keeping the full alias chain.
 *
 * Memoised depth-first, NOT a pass over `graph.topoOrder`.
 *
 * The order was computed by `buildGraph` from the VENDORED alias edges. A repoint
 * changes the edges but not the order, so a token repointed onto a target that
 * happens to sit later in the order found `resolved.get(target)` empty and was
 * written down as `{ value: '', unresolved: true }` — a legal edit resolving to
 * nothing. That is not a corner case: `buildGraph` documents that 24 of the V3
 * semantic tokens alias their own siblings, so sys→sys repointing is a first-class
 * operation and roughly half of those orderings hit it. The symptom was delayed,
 * which is what made it nasty: the cheap path (`resolveSubset`) got it right, so
 * the value only went blank on the next full rebuild — a slider move, or a reload.
 *
 * Resolving on demand means the effective edge set is the only thing that decides,
 * and the order cannot go stale because it is never consulted. Chains are at most
 * a handful of tiers deep, so the recursion is shallow; the `visiting` set keeps a
 * cycle from becoming a stack overflow.
 *
 * The palette engine's output is injected here, not computed here. The engine
 * knows nothing about aliases and this module does no colour maths.
 */

import type { PaletteSolution } from '../engine/types';
import type { NodeId, ResolvedToken, TokenGraph } from './types';

export type Resolved = Map<NodeId, ResolvedToken>;

/**
 * Which ref node each engine-owned rung feeds.
 * `electricBlue.500` -> `ref.palette.electricBlue.500`
 */
export function rungToNodeId(rung: string): NodeId {
    return `ref.palette.${rung}`;
}

export interface ResolveOptions {
    /** Palette solution whose hexes override the vendored `derived` nodes. */
    solution?: PaletteSolution;
    /** Sparse alias repoints layered over the vendored graph. */
    aliasOverrides?: Map<NodeId, NodeId>;
}

export function resolveGraph(graph: TokenGraph, options: ResolveOptions = {}): Resolved {
    const { solution, aliasOverrides } = options;
    const resolved: Resolved = new Map();

    // Engine hexes, keyed by the ref node they feed.
    const engineValues = new Map<NodeId, string>();
    if (solution) {
        for (const [rung, solved] of solution.rungs) {
            engineValues.set(rungToNodeId(rung), solved.hex);
        }
    }

    /** Nodes on the current descent, so a cycle terminates instead of recursing. */
    const visiting = new Set<NodeId>();

    const resolveOne = (id: NodeId): ResolvedToken => {
        const cached = resolved.get(id);
        if (cached) return cached;

        const node = graph.nodes.get(id);
        if (!node) {
            // A target the graph does not declare. Dangling aliases are reported at
            // load time; surfaced here as a value rather than a crash so the UI can
            // still render the row.
            const missing: ResolvedToken = { value: '', chain: [id], unresolved: true };
            resolved.set(id, missing);
            return missing;
        }

        // The engine wins over the vendored literal for any rung it owns. This
        // is the seam that makes an anchor edit cascade through the whole graph.
        const fromEngine = engineValues.get(id);
        if (fromEngine !== undefined) {
            const value: ResolvedToken = { value: fromEngine, chain: [id] };
            resolved.set(id, value);
            return value;
        }

        const override = aliasOverrides?.get(id);
        const target = override ?? (node.source.kind === 'alias' ? node.source.target : undefined);

        if (target === undefined) {
            const value: ResolvedToken =
                node.source.kind === 'literal'
                    ? { value: node.source.value, chain: [id] }
                    : // A `derived` node with no solution supplied.
                      { value: '', chain: [id], unresolved: true };
            resolved.set(id, value);
            return value;
        }

        if (visiting.has(target)) {
            const cyclic: ResolvedToken = { value: '', chain: [id, target], unresolved: true };
            resolved.set(id, cyclic);
            return cyclic;
        }

        visiting.add(id);
        const upstream = resolveOne(target);
        visiting.delete(id);

        const value: ResolvedToken = {
            value: upstream.value,
            chain: [id, ...upstream.chain],
            unresolved: upstream.unresolved,
        };
        resolved.set(id, value);
        return value;
    };

    for (const id of graph.nodes.keys()) resolveOne(id);

    return resolved;
}

/**
 * Re-resolve only what an edit touched, in place.
 * Used for alias repoints, where the fan-out is tiny and a full pass is waste.
 */
export function resolveSubset(
    graph: TokenGraph,
    resolved: Resolved,
    order: NodeId[],
    aliasOverrides?: Map<NodeId, NodeId>,
): void {
    for (const id of order) {
        const node = graph.nodes.get(id);
        if (!node) continue;

        const override = aliasOverrides?.get(id);
        const target = override ?? (node.source.kind === 'alias' ? node.source.target : undefined);

        if (target === undefined) continue; // literals and engine rungs are unaffected

        const upstream = resolved.get(target);
        if (!upstream) {
            // Do NOT leave the previous value standing: that is a stale hex with no
            // `unresolved` flag, which reads as a real colour everywhere downstream.
            // Saying "unresolved" is wrong-but-visible; keeping the old value is
            // wrong-and-invisible.
            resolved.set(id, { value: '', chain: [id, target], unresolved: true });
            continue;
        }
        resolved.set(id, {
            value: upstream.value,
            chain: [id, ...upstream.chain],
            unresolved: upstream.unresolved,
        });
    }
}

/**
 * A comp token that aliases the reference layer directly, skipping semantics.
 *
 * 109 of the 261 comp tokens do this — 42%, not a handful. It is worth a lint
 * badge rather than a fix: the DS made that choice deliberately in places, but
 * it also means those tokens ignore any semantic repointing done in this app.
 */
export function bypassesSemanticLayer(graph: TokenGraph, id: NodeId, resolved: Resolved): boolean {
    const node = graph.nodes.get(id);
    if (!node || node.tier !== 'comp') return false;
    const chain = resolved.get(id)?.chain ?? [];
    return !chain.some((step) => graph.nodes.get(step)?.tier === 'sys');
}

/** True when a chain terminates in the V2 palette — i.e. V3 edits will not move it. */
export function tracesToV2(graph: TokenGraph, id: NodeId, resolved: Resolved): boolean {
    const chain = resolved.get(id)?.chain ?? [];
    const terminal = chain[chain.length - 1];
    return graph.nodes.get(terminal)?.palette === 'v2';
}
