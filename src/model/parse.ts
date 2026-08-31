/**
 * Parse the vendored Style Dictionary JSON into a flat node list.
 *
 * Style Dictionary references look like `{ref.palette.orange.500}`. A value is
 * an alias when it is EXACTLY one reference and nothing else; a value that
 * merely contains one (a gradient, a shadow) is treated as a literal, because
 * repointing it would be a string edit rather than a graph edit.
 */

import { cssVarFromPath } from './cssName';
import {
    isColorPath,
    type Diagnostic,
    type NodeId,
    type TokenNode,
    type Tier,
    type PaletteTag,
    type TokenSource,
} from './types';

/** A whole-value reference: `{a.b.c}` with no surrounding text. */
const WHOLE_REFERENCE = /^\{([^}]+)\}$/;

/** Keys that carry documentation rather than tokens. */
function isCommentKey(key: string): boolean {
    return key.startsWith('_');
}

export interface ParsedFile {
    /** Vendor-relative path, e.g. `tokens/system/color-surface.json`. */
    originFile: string;
    json: unknown;
}

export interface ParseResult {
    nodes: TokenNode[];
    diagnostics: Diagnostic[];
}

/**
 * Which palette a node belongs to.
 *
 * On the REF tier the two palettes are now separate namespaces rather than one
 * namespace with a `v3` segment inside it: `ref.palette.*` is the V3 scale and
 * `ref.color.*` is the legacy V2 one, which the design system marks deprecated.
 * That replaced `ref.color.v3.*` vs `ref.color.*`, where the discriminator was the
 * third segment and every consumer had to know to test it before the second.
 *
 * On the SYS tier the split is unchanged, and it is by role vocabulary rather than
 * by file: `sys.color.{surface,text,icon,border,link,data}` is the V3 usage layer,
 * while `sys.color.{main,accent,error,warning,success,featureLock}` is the legacy
 * intent layer still bound to V2 primitives. The files those roles live in were
 * renamed `color-*.json` -> `role-*.json`, and the token paths did not move, which
 * is why this set needed no edit.
 */
const V3_SYS_ROLES = new Set(['surface', 'text', 'icon', 'border', 'link', 'data']);

export function paletteOf(path: readonly string[], isColor: boolean): PaletteTag {
    if (!isColor) return 'none';
    const [tier, second, third] = path;

    if (tier === 'ref') {
        if (second === 'palette') return 'v3';
        if (second === 'color') return 'v2';
        return 'none';
    }

    if (tier === 'sys') {
        if (second !== 'color') return 'none';
        return V3_SYS_ROLES.has(third ?? '') ? 'v3' : 'v2';
    }

    // The comp tier is not palette-scoped in itself; what matters is what it
    // resolves to, which the resolver reports. Treat it as v3-managed so it
    // stays editable.
    return 'v3';
}

export function parseFiles(files: ParsedFile[]): ParseResult {
    const nodes: TokenNode[] = [];
    const diagnostics: Diagnostic[] = [];
    const seenCssVar = new Map<string, NodeId>();

    for (const file of files) {
        walk(file.json, [], file.originFile);
    }

    function walk(value: unknown, path: string[], originFile: string): void {
        if (value === null || typeof value !== 'object') return;
        const obj = value as Record<string, unknown>;

        // A token leaf is an object carrying `value`.
        if ('value' in obj && (typeof obj.value === 'string' || typeof obj.value === 'number')) {
            emit(String(obj.value), path, originFile, obj.description as string | undefined);
            return;
        }

        for (const key of Object.keys(obj)) {
            if (isCommentKey(key)) continue;
            walk(obj[key], [...path, key], originFile);
        }
    }

    function emit(raw: string, path: string[], originFile: string, description?: string): void {
        const id = path.join('.');
        const tier = path[0] as Tier;
        if (tier !== 'ref' && tier !== 'sys' && tier !== 'comp') return;

        const isColor = isColorPath(path);
        const palette = paletteOf(path, isColor);
        const cssVar = cssVarFromPath(path);

        const match = WHOLE_REFERENCE.exec(raw.trim());
        let source: TokenSource;
        if (match) {
            source = { kind: 'alias', target: match[1].trim() };
        } else {
            source = { kind: 'literal', value: raw };
        }

        // --- invariant: a semantic colour token may not hold a literal -------
        // This is the rule "define --sys with --ref, never a hex". A literal
        // here means someone bypassed the reference layer, and it must surface
        // loudly rather than render as an uneditable swatch.
        if (tier === 'sys' && isColor && source.kind === 'literal') {
            diagnostics.push({
                severity: 'error',
                code: 'sys-literal',
                message:
                    `${id} holds the literal value "${raw}" instead of aliasing a reference token. ` +
                    `Semantic colour tokens must point at a --ref-* token so the palette can ` +
                    `cascade into them. Fix it in ${originFile}.`,
                nodes: [id],
            });
        }

        const previous = seenCssVar.get(cssVar);
        if (previous && previous !== id) {
            diagnostics.push({
                severity: 'error',
                code: 'duplicate-css-name',
                message: `${id} and ${previous} both derive the CSS name ${cssVar}.`,
                nodes: [id, previous],
            });
        }
        seenCssVar.set(cssVar, id);

        nodes.push({
            id,
            path,
            cssVar,
            tier,
            palette,
            originFile,
            source,
            // "Editable" means: this token's alias can be repointed.
            //
            // Reference tokens hold VALUES, not aliases — the V3 rungs belong to
            // the palette engine and the V2 ones are legacy production values —
            // so neither is editable from a token table.
            //
            // Every sys/comp ALIAS is repointable, INCLUDING the legacy V2-era
            // intent layer (`sys.color.{main,accent,error,…}`). Those still
            // point at the V2 palette, and repointing them onto V3 references is
            // precisely the migration worth planning here; locking them by
            // palette would have removed the one edit that matters on them.
            editable: tier !== 'ref' && source.kind === 'alias',
            isColor,
            description,
        });
    }

    return { nodes, diagnostics };
}
