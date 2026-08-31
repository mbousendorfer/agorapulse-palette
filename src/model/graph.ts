/**
 * Build the alias DAG, topologically order it, and guard against cycles.
 *
 * Two separate mechanisms, because they answer different questions:
 *
 *  - **Load time**: Kahn's algorithm. Any node left with residual in-degree is
 *    in a cycle, and we report the cycle by name instead of blowing the stack
 *    on the first resolve.
 *  - **Edit time**: `canRepoint`. A repoint a -> b is legal iff a is not
 *    reachable from b. Real chain depth is at most 4 (comp -> sys -> sys ->
 *    ref) so a bounded DFS is free.
 *
 * Note that comparing topological indices is NOT a valid legality test here.
 * The sys tier aliases its own siblings (24 of the 121 V3 sys tokens do), so a
 * same-tier edge is legal in one direction and illegal in the other, and an
 * index comparison would reject valid repoints.
 */

import type { Diagnostic, NodeId, TokenGraph, TokenNode } from './types';

export function buildGraph(nodes: TokenNode[], parseDiagnostics: Diagnostic[] = []): TokenGraph {
    const nodeMap = new Map<NodeId, TokenNode>(nodes.map((n) => [n.id, n]));
    const diagnostics = [...parseDiagnostics];

    const edgesOut = new Map<NodeId, NodeId>();
    const edgesIn = new Map<NodeId, NodeId[]>();

    for (const node of nodes) {
        if (node.source.kind !== 'alias') continue;
        const target = node.source.target;
        if (!nodeMap.has(target)) {
            diagnostics.push({
                severity: 'error',
                code: 'dangling-alias',
                message: `${node.id} aliases ${target}, which does not exist.`,
                nodes: [node.id],
            });
            continue;
        }
        edgesOut.set(node.id, target);
        const list = edgesIn.get(target);
        if (list) list.push(node.id);
        else edgesIn.set(target, [node.id]);
    }

    const { order, cycles } = topoSort(nodes, edgesOut);
    for (const cycle of cycles) {
        diagnostics.push({
            severity: 'error',
            code: 'alias-cycle',
            message: `Alias cycle: ${cycle.join(' -> ')} -> ${cycle[0]}`,
            nodes: cycle,
        });
    }

    return { nodes: nodeMap, edgesOut, edgesIn, topoOrder: order, diagnostics };
}

/**
 * Kahn, over "depends on" edges. A node must come AFTER its alias target, so
 * that resolving in order means a target is always already resolved.
 */
function topoSort(
    nodes: TokenNode[],
    edgesOut: Map<NodeId, NodeId>,
): { order: NodeId[]; cycles: NodeId[][] } {
    // dependents[target] = nodes that must come after target
    const dependents = new Map<NodeId, NodeId[]>();
    const indegree = new Map<NodeId, number>();

    for (const node of nodes) indegree.set(node.id, 0);

    for (const [from, to] of edgesOut) {
        // `from` depends on `to`, so to -> from in emission order.
        const list = dependents.get(to);
        if (list) list.push(from);
        else dependents.set(to, [from]);
        indegree.set(from, (indegree.get(from) ?? 0) + 1);
    }

    const queue: NodeId[] = [];
    for (const [id, deg] of indegree) if (deg === 0) queue.push(id);

    const order: NodeId[] = [];
    while (queue.length > 0) {
        const id = queue.shift()!;
        order.push(id);
        for (const dep of dependents.get(id) ?? []) {
            const next = (indegree.get(dep) ?? 0) - 1;
            indegree.set(dep, next);
            if (next === 0) queue.push(dep);
        }
    }

    // Anything left has residual in-degree: it is in, or downstream of, a cycle.
    const cycles: NodeId[][] = [];
    const stuck = [...indegree.entries()].filter(([, d]) => d > 0).map(([id]) => id);
    const seen = new Set<NodeId>();
    for (const start of stuck) {
        if (seen.has(start)) continue;
        // Walk forward until we revisit something: that is the cycle.
        const path: NodeId[] = [];
        const onPath = new Map<NodeId, number>();
        let cur: NodeId | undefined = start;
        while (cur !== undefined && !onPath.has(cur)) {
            onPath.set(cur, path.length);
            path.push(cur);
            cur = edgesOut.get(cur);
        }
        if (cur !== undefined) {
            const cycle = path.slice(onPath.get(cur));
            for (const id of cycle) seen.add(id);
            cycles.push(cycle);
        }
        for (const id of path) seen.add(id);
    }

    return { order, cycles };
}

const EMPTY_OVERRIDES: ReadonlyMap<NodeId, NodeId> = new Map();

export interface RepointCheck {
    ok: boolean;
    /** When illegal, the path that would close the loop. */
    cyclePath?: NodeId[];
    reason?: string;
}

/**
 * Would pointing `from` at `to` create a cycle?
 *
 * Bounded DFS from `to` following alias edges, looking for `from`. If we can
 * reach `from`, then `from -> to` closes a loop.
 */
export function canRepoint(
    graph: TokenGraph,
    from: NodeId,
    to: NodeId,
    aliasOverrides: ReadonlyMap<NodeId, NodeId> = EMPTY_OVERRIDES,
): RepointCheck {
    if (from === to) {
        return { ok: false, cyclePath: [from], reason: 'A token cannot alias itself.' };
    }
    if (!graph.nodes.has(to)) {
        return { ok: false, reason: `${to} does not exist.` };
    }

    const path: NodeId[] = [to];
    let cur: NodeId | undefined = to;
    const visited = new Set<NodeId>([to]);

    while (cur !== undefined) {
        // An override, where one exists, is what `cur` actually resolves through now —
        // preferring it over the vendored edge keeps this check in sync with
        // `dependentsOf`'s same override-awareness below.
        const next: NodeId | undefined = aliasOverrides.get(cur) ?? graph.edgesOut.get(cur);
        if (next === undefined) break;
        if (next === from) {
            return {
                ok: false,
                cyclePath: [from, ...path, from],
                reason:
                    `${to} already resolves through ${from}, so pointing ${from} at ${to} ` +
                    `would close a loop.`,
            };
        }
        if (visited.has(next)) break; // pre-existing cycle; reported at load time
        visited.add(next);
        path.push(next);
        cur = next;
    }

    return { ok: true };
}

/**
 * Everything downstream of `roots`, in topological order.
 * This is what an alias repoint re-resolves — typically 0 to 9 nodes.
 *
 * `graph.edgesIn` alone answers this against the VENDORED graph, which is wrong once a
 * repoint chains through another repoint: override `A -> B`, then override `B -> C` —
 * `A` vendor-aliases neither `B` nor `C`, so a walk over `edgesIn` alone never revisits
 * it, and `A` keeps showing `B`'s pre-repoint colour until an unrelated edit forces a
 * full rebuild. `aliasOverrides`, reverse-indexed the same way `edgesIn` already
 * reverses `edgesOut`, closes that gap: it is the caller's CURRENT override map, so it
 * always includes overrides made earlier in the same session, not just this one.
 */
export function dependentsOf(
    graph: TokenGraph,
    roots: NodeId[],
    aliasOverrides: ReadonlyMap<NodeId, NodeId> = EMPTY_OVERRIDES,
): NodeId[] {
    const overrideIn = new Map<NodeId, NodeId[]>();
    for (const [from, to] of aliasOverrides) {
        const list = overrideIn.get(to);
        if (list) list.push(from);
        else overrideIn.set(to, [from]);
    }

    const dirty = new Set<NodeId>(roots);
    const queue = [...roots];
    while (queue.length > 0) {
        const id = queue.shift()!;
        const deps = [...(graph.edgesIn.get(id) ?? []), ...(overrideIn.get(id) ?? [])];
        for (const dep of deps) {
            if (!dirty.has(dep)) {
                dirty.add(dep);
                queue.push(dep);
            }
        }
    }
    return graph.topoOrder.filter((id) => dirty.has(id));
}
