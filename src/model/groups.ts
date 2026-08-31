/**
 * Group tokens the way the Figma `System Tokens` collection groups them.
 *
 * Figma's Groups panel is a tree over the variable name, with inclusive counts
 * on every node, in a deliberate order — `text · icon · link · border · surface
 * · data`, not alphabetical. Sorting by id instead scatters that vocabulary and
 * loses the reading order the collection was designed with.
 *
 * The hierarchy itself is derived from the token paths, so a new group appears
 * on its own. Only the ORDER is declared, because order is a design decision
 * the paths do not carry.
 */

import type { NodeId, TokenNode } from './types';

/**
 * Declared child order, keyed by the dotted group path (relative to the tier).
 * Anything not listed sorts after the listed entries, alphabetically — so the
 * tree stays complete when the collection grows.
 *
 * Transcribed from the Groups panel of the Figma collection. Note `border`
 * lists `interactive` before `input` even though they are the same size, and
 * `surface.interactive` nests `error` and `featurelock`.
 */
const CHILD_ORDER: Record<string, string[]> = {
    '': ['color', 'height', 'radius', 'motion', 'spacing'],
    color: [
        // The V3 usage layer, in the collection's own reading order.
        'text',
        'icon',
        'link',
        'border',
        'surface',
        'data',
        // The V2-era intent layer, which the Figma collection does not contain.
        // Kept last so the current vocabulary reads first.
        'main',
        'accent',
        'error',
        'warning',
        'success',
        'featureLock',
    ],
    'color.text': ['interactive', 'category'],
    'color.icon': ['interactive', 'category'],
    'color.border': ['interactive', 'input'],
    'color.surface': ['interactive', 'input', 'category'],
    'color.surface.interactive': ['error', 'featurelock'],
};

export interface GroupNode {
    /** Dotted path relative to the tier, e.g. `color.surface.interactive`. */
    path: string;
    label: string;
    depth: number;
    /** Inclusive of every descendant, like Figma's panel. */
    count: number;
    /** Tokens sitting directly in this group rather than in a child. */
    directCount: number;
    children: GroupNode[];
}

/**
 * Segments that name WHAT is painted rather than WHICH variant is painted.
 *
 * In the component tier a token path runs
 * `<component>.<variant…>.<property>[.<state>]` — `button.primary.orange.surface.default`.
 * Grouping on the property turns the navigator into a list of `surface` and
 * `border` folders repeated under every variant, which says nothing: a component
 * has variants, and each variant paints the same handful of properties.
 *
 * So the group path is cut at the FIRST property segment, leaving components and
 * their variants. Cutting at the first rather than trimming from the end matters:
 * the state follows the property (`…border.hovered`), so a trailing trim would
 * stop at the state and keep the property.
 *
 * This applies to the COMPONENT tier only. In the semantic tier `surface`,
 * `text`, `icon` and `border` are the roles themselves — the vocabulary the
 * Figma collection is organised around — and must stay.
 */
const PROPERTY_SEGMENTS = new Set([
    'surface',
    'border',
    'background',
    'content',
    'text',
    'icon',
    'fill',
    'dot',
    'symbol',
    'initials',
    'label',
    'description',
    'title',
    'caption',
    'separator',
    'radius',
    'padding',
    'spacing',
    'height',
    'width',
    'shadow',
    'color',
]);

/** Segments of a token id below its tier, e.g. `color.surface.default`. */
function groupSegments(node: TokenNode): string[] {
    const segs = node.path.slice(1);
    if (node.tier !== 'comp') return segs;

    // Keep the component name whatever it is, then stop at the first property.
    const cut = segs.findIndex((s, i) => i > 0 && PROPERTY_SEGMENTS.has(s));
    // The final segment is the token's own name, and callers drop it themselves;
    // keep it so that contract holds even when everything before it was cut.
    if (cut === -1) return segs;
    return [...segs.slice(0, cut), segs[segs.length - 1]];
}

function orderChildren(parentPath: string, names: string[]): string[] {
    const declared = CHILD_ORDER[parentPath] ?? [];
    const rank = new Map(declared.map((n, i) => [n, i]));
    return [...names].sort((a, b) => {
        const ra = rank.get(a);
        const rb = rank.get(b);
        if (ra !== undefined && rb !== undefined) return ra - rb;
        if (ra !== undefined) return -1;
        if (rb !== undefined) return 1;
        return a.localeCompare(b, undefined, { numeric: true });
    });
}

/**
 * Build the group tree for a set of tokens.
 *
 * A token's LAST segment is its own name, not a group — `color.surface.default`
 * lives in group `color.surface`. Treating it as a group would invent a leaf
 * group per token and make every count read 1.
 */
export function buildGroupTree(nodes: TokenNode[]): GroupNode {
    interface Raw {
        direct: number;
        children: Map<string, Raw>;
    }
    const root: Raw = { direct: 0, children: new Map() };

    for (const node of nodes) {
        const segs = groupSegments(node);
        const groupPath = segs.slice(0, -1); // drop the token's own name
        let cursor = root;
        for (const seg of groupPath) {
            let next = cursor.children.get(seg);
            if (!next) {
                next = { direct: 0, children: new Map() };
                cursor.children.set(seg, next);
            }
            cursor = next;
        }
        cursor.direct += 1;
    }

    const build = (raw: Raw, path: string, label: string, depth: number): GroupNode => {
        const childNames = orderChildren(path, [...raw.children.keys()]);
        const children = childNames.map((name) =>
            build(raw.children.get(name)!, path ? `${path}.${name}` : name, name, depth + 1),
        );
        const count = raw.direct + children.reduce((sum, c) => sum + c.count, 0);
        return { path, label, depth, count, directCount: raw.direct, children };
    };

    return build(root, '', 'All', -1);
}

/** Depth-first flattening, for rendering the tree as rows. */
export function flattenGroups(root: GroupNode): GroupNode[] {
    const out: GroupNode[] = [];
    const walk = (n: GroupNode) => {
        if (n.depth >= 0) out.push(n);
        for (const c of n.children) walk(c);
    };
    walk(root);
    return out;
}

/**
 * Sort tokens into the tree's reading order.
 *
 * Two tokens are compared segment by segment, using the declared child order at
 * each level. Within the same group, tokens keep a natural sort so `100` comes
 * before `200` and `active-hovered` groups with `active`.
 */
export function sortByGroupOrder(nodes: TokenNode[]): TokenNode[] {
    const rankAt = (parentPath: string, name: string): number => {
        const declared = CHILD_ORDER[parentPath];
        if (!declared) return Number.MAX_SAFE_INTEGER;
        const i = declared.indexOf(name);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };

    return [...nodes].sort((a, b) => {
        const sa = groupSegments(a);
        const sb = groupSegments(b);
        let parent = '';
        const depth = Math.min(sa.length, sb.length);

        for (let i = 0; i < depth; i++) {
            if (sa[i] !== sb[i]) {
                // Only the non-final segments are groups; a final segment is the
                // token's own name and is never in the declared order.
                const aIsGroup = i < sa.length - 1;
                const bIsGroup = i < sb.length - 1;

                // A token sitting DIRECTLY in a group reads before that group's
                // subgroups, matching how Figma lists a group's own variables
                // first. This has to be tested before the declared rank: a
                // declared subgroup ranks 0 while a direct token ranks MAX, so
                // comparing ranks first would always hoist the subgroup and this
                // branch would never be reached.
                if (aIsGroup !== bIsGroup) return aIsGroup ? 1 : -1;

                const ra = aIsGroup ? rankAt(parent, sa[i]) : Number.MAX_SAFE_INTEGER;
                const rb = bIsGroup ? rankAt(parent, sb[i]) : Number.MAX_SAFE_INTEGER;
                if (ra !== rb) return ra - rb;
                return sa[i].localeCompare(sb[i], undefined, { numeric: true });
            }
            parent = parent ? `${parent}.${sa[i]}` : sa[i];
        }
        if (sa.length !== sb.length) return sa.length - sb.length;
        // Component paths are trimmed at the property, so two tokens can reduce
        // to the same segments — `…orange.surface.default` and
        // `…orange.border.default`. Fall back to the full id so their order is
        // stable and readable rather than whatever the graph happened to hold.
        return a.id.localeCompare(b.id, undefined, { numeric: true });
    });
}

/** Is a token inside the given group (or the whole set, for the root)? */
export function inGroup(node: TokenNode, groupPath: string): boolean {
    if (!groupPath) return true;
    const segs = groupSegments(node).slice(0, -1).join('.');
    return segs === groupPath || segs.startsWith(`${groupPath}.`);
}

/** The group a token belongs to, for rendering section headers. */
export function groupOf(node: TokenNode): string {
    return groupSegments(node).slice(0, -1).join('.');
}

/**
 * What a row needs to say, given that its section header already says the group.
 *
 * `sys.color.text.interactive.active` under the header `color / text /
 * interactive` only needs to read `active`. Repeating the full path per row is
 * what forced the name column to wrap to three lines.
 *
 * For component tokens the group is trimmed at the property, so the remainder is
 * the part that was trimmed: `button.primary.orange` + `surface / default`. That
 * is the useful half — it says what the token paints.
 */
export function labelAfterGroup(node: TokenNode): string {
    const group = groupSegments(node).slice(0, -1);
    const full = node.path.slice(1);
    // Drop the group's segments from the front of the full path, matching
    // segment by segment so a trimmed component path lines up correctly.
    let i = 0;
    let g = 0;
    while (i < full.length && g < group.length) {
        if (full[i] === group[g]) g++;
        i++;
    }
    const rest = full.slice(i);
    return rest.length ? rest.join(' / ') : full[full.length - 1];
}

export type { NodeId };
