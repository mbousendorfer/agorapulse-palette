/**
 * Read a Figma variables export into the shape this app already thinks in.
 *
 * Figma exports DTCG (`.tokens.json`) with its own data under `$extensions`, one file per
 * MODE per collection. Three facts about that export drove every decision here, and all
 * three were measured against the real files rather than assumed:
 *
 *  1. **The join key differs per collection.** `com.figma.codeSyntax.WEB` carries the exact
 *     CSS custom property — `var(--ref-color-grey-100)` — and is authoritative wherever it
 *     exists. But it is filled on 123/130 Reference tokens, 5/69 Component tokens and
 *     **0/130 System tokens**. So System and Component have to be joined on the token PATH
 *     (`color.text.default` → `--sys-color-text-default`), which matched 98/130 and 61/69.
 *     One key for everything would silently drop a whole collection.
 *
 *  2. **The alias survives, but not in `$value`.** A cross-collection reference is resolved
 *     to a literal colour in `$value`, and the relationship is preserved out of band in
 *     `com.figma.aliasData.targetVariableName`. Reading only `$value` would import 92 of the
 *     115 System colours as hardcoded hex — destroying the one relationship this whole app is
 *     about, and violating the rule that a `sys` colour never holds a literal. Same-collection
 *     aliases DO use `$value` as `{color.text.default}`, so both forms have to be read.
 *
 *  3. **`codeSyntax` is hand-typed, so it is dirty.** One Reference token's WEB syntax holds a
 *     commented-out placeholder — a `TO ADD` note wrapped in CSS comment delimiters around a
 *     `var()` call — that someone left in the field. Anything that does not parse as exactly
 *     one `var(--name)` is refused and falls back to the path, rather than becoming a token
 *     named after a comment.
 *
 * Modes: only the mode asked for is read. `System` and `Component` ship `Default` and
 * `Accessible`; the app's model is single-valued per token, so importing both would need a
 * mode-aware graph. Default is the one that corresponds to the shipped CSS.
 */

/** Which collection a file came from — it decides the prefix and the join rule. */
export type FigmaCollection = 'reference' | 'system' | 'component';

export const PREFIX: Record<FigmaCollection, string> = {
    reference: '--ref',
    system: '--sys',
    component: '--comp',
};

export interface FigmaToken {
    /** The CSS custom property this token is, `--sys-color-text-default`. */
    cssVar: string;
    collection: FigmaCollection;
    /** DTCG `$type`: `color`, `number`, `duration`, `easing`, `string`. */
    type: string;
    /** Resolved literal — a hex for a colour, the raw value otherwise. Null when unusable. */
    value: string | null;
    /**
     * What this token points at, as a CSS custom property, or null when it holds a literal.
     * Recovered from `aliasData` for cross-collection and from `$value` for same-collection.
     */
    aliasOf: string | null;
    /** Figma's own path, kept so a report can name what the designer sees. */
    figmaPath: string;
    /** How `cssVar` was decided, so a diff can say why a name did not line up. */
    joinedBy: 'codeSyntax' | 'path';
}

export interface ParseResult {
    tokens: FigmaToken[];
    /** Tokens that could not be given a name at all, with the reason. */
    skipped: Array<{ figmaPath: string; reason: string }>;
}

/** `Colors.Grey.grey-1000` and `color.text.default` both become dash-joined lowercase. */
function slug(part: string): string {
    return part
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Figma's Reference group names, spelled the way the CSS spells them.
 *
 * The two collections do not agree with each other, let alone with the code: Reference uses
 * title-case plurals (`Border Radius`, `Spacings`, `Fonts`, `Colors`, `Icons`) while System
 * uses lowercase singulars (`color`, `height`, `radius`, `motion`, `spacing`). The CSS is
 * singular throughout — `--ref-color-white`, `--ref-spacing-xxs` — so without this map every
 * cross-collection alias resolved to `--ref-colors-grey-1000` and matched nothing: 99 of the
 * 121 System aliases pointed at a token that does not exist.
 *
 * Written out rather than derived by stripping an `s`: `Icons` → `icon` is right and
 * `Spacings` → `spacing` is right, but a general rule would also rewrite any future group
 * whose name genuinely ends in one.
 */
const GROUP_SPELLING: Record<string, string> = {
    colors: 'color',
    spacings: 'spacing',
    fonts: 'font',
    icons: 'icon',
};

/**
 * The name a path implies.
 *
 * Figma repeats the group inside the leaf — the group `Border Radius` holds
 * `border-radius-sm` — so joining every part would produce
 * `--ref-border-radius-border-radius-sm`. A part that the NEXT part already starts with is
 * dropped, which is what makes the path join land on the app's real names.
 */
export function nameFromPath(collection: FigmaCollection, path: readonly string[]): string {
    const parts: string[] = [];
    for (let i = 0; i < path.length; i++) {
        const here = GROUP_SPELLING[slug(path[i])] ?? slug(path[i]);
        if (!here) continue;
        const next = i + 1 < path.length ? slug(path[i + 1]) : null;
        if (next && (next === here || next.startsWith(`${here}-`))) continue;
        parts.push(here);
    }
    return `${PREFIX[collection]}-${parts.join('-')}`;
}

/**
 * The name `codeSyntax.WEB` claims, or null when the field does not hold exactly one
 * `var(--name)`. See the docblock: this field is typed by hand and one of them is a comment.
 */
export function nameFromCodeSyntax(web: unknown): string | null {
    if (typeof web !== 'string') return null;
    const match = /^\s*var\(\s*(--[A-Za-z0-9-]+)\s*\)\s*$/.exec(web);
    return match ? match[1] : null;
}

/** `{color.text.default}` → `--sys-color-text-default`, within one collection. */
function nameFromCurly(collection: FigmaCollection, value: string): string | null {
    const inner = /^\{([^}]+)\}$/.exec(value.trim());
    if (!inner) return null;
    return nameFromPath(collection, inner[1].split('.'));
}

/**
 * `Colors/Grey/grey-1000` in collection `Reference tokens` → `--ref-color-grey-1000`.
 *
 * The target's collection comes from `targetVariableSetName`, because a System token can
 * point at another System token as easily as at a Reference one, and guessing the tier from
 * the name would get `Colors/...` wrong in the System collection.
 */
function nameFromAliasData(data: Record<string, unknown>): string | null {
    const target = data.targetVariableName;
    const set = data.targetVariableSetName;
    if (typeof target !== 'string') return null;
    const collection = collectionOf(typeof set === 'string' ? set : '');
    if (!collection) return null;
    return nameFromPath(collection, target.split('/'));
}

/** Figma's collection names, as they appear in the export and in `targetVariableSetName`. */
export function collectionOf(name: string): FigmaCollection | null {
    const n = name.toLowerCase();
    if (n.includes('reference')) return 'reference';
    if (n.includes('system')) return 'system';
    if (n.includes('component')) return 'component';
    return null;
}

/** A DTCG colour value is `{colorSpace, components, alpha, hex}` in current Figma exports. */
function colourLiteral(value: unknown): string | null {
    if (typeof value === 'string') return value.startsWith('{') ? null : value.toLowerCase();
    if (value && typeof value === 'object' && 'hex' in value) {
        const hex = (value as { hex?: unknown }).hex;
        if (typeof hex === 'string') return hex.toLowerCase();
    }
    return null;
}

interface RawToken {
    path: string[];
    $type?: unknown;
    $value?: unknown;
    $extensions?: Record<string, unknown>;
}

function collect(node: unknown, path: string[], out: RawToken[]): void {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key.startsWith('$')) continue;
        if (!value || typeof value !== 'object') continue;
        if ('$value' in value) {
            out.push({ path: [...path, key], ...(value as object) });
        } else {
            collect(value, [...path, key], out);
        }
    }
}

/** Parse one mode file of one collection. */
export function parseTokensFile(json: unknown, collection: FigmaCollection): ParseResult {
    const raw: RawToken[] = [];
    collect(json, [], raw);

    const tokens: FigmaToken[] = [];
    const skipped: ParseResult['skipped'] = [];

    for (const token of raw) {
        const figmaPath = token.path.join('.');
        const extensions = token.$extensions ?? {};
        const syntax = extensions['com.figma.codeSyntax'] as Record<string, unknown> | undefined;

        const fromSyntax = nameFromCodeSyntax(syntax?.WEB);
        const cssVar = fromSyntax ?? nameFromPath(collection, token.path);
        if (!cssVar || cssVar === PREFIX[collection] || cssVar.endsWith('-')) {
            skipped.push({ figmaPath, reason: 'no usable name' });
            continue;
        }

        const type = typeof token.$type === 'string' ? token.$type : 'unknown';

        // Cross-collection first: it is the authoritative relationship when present, and a
        // token carrying `aliasData` also carries the RESOLVED literal in `$value`.
        const aliasData = extensions['com.figma.aliasData'] as Record<string, unknown> | undefined;
        let aliasOf = aliasData ? nameFromAliasData(aliasData) : null;
        if (!aliasOf && typeof token.$value === 'string') {
            aliasOf = nameFromCurly(collection, token.$value);
        }

        const value =
            type === 'color'
                ? colourLiteral(token.$value)
                : typeof token.$value === 'string' || typeof token.$value === 'number'
                  ? String(token.$value)
                  : null;

        tokens.push({
            cssVar,
            collection,
            type,
            value,
            aliasOf,
            figmaPath,
            joinedBy: fromSyntax ? 'codeSyntax' : 'path',
        });
    }

    return { tokens, skipped };
}

/**
 * Fill in the value of every token that only has an alias.
 *
 * Figma resolves a CROSS-collection reference to a literal before exporting, so those tokens
 * already carry their colour. A SAME-collection reference does not: `color.icon.default` exports
 * as `{color.text.default}` with no value at all. Without this, all 23 System icon tokens
 * rendered as `#000000` — a colour none of them holds — which is worse than showing nothing,
 * because it looks like data.
 *
 * Walks the chain rather than following one hop: an icon can point at a text token that itself
 * points at a reference. `seen` stops a cycle from hanging the import; Figma should not permit
 * one, but a vendored file is input and input is not a promise.
 */
export function resolveValues(collections: Array<{ tokens: FigmaToken[] }>): void {
    const byVar = new Map<string, FigmaToken>();
    for (const c of collections) for (const t of c.tokens) byVar.set(t.cssVar, t);

    for (const c of collections) {
        for (const token of c.tokens) {
            if (token.value !== null) continue;
            const seen = new Set<string>([token.cssVar]);
            let at = token.aliasOf;
            while (at && !seen.has(at)) {
                seen.add(at);
                const next = byVar.get(at);
                if (!next) break;
                if (next.value !== null) {
                    token.value = next.value;
                    break;
                }
                at = next.aliasOf;
            }
        }
    }
}
