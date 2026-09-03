/**
 * What a colour is FOR: brand design, product design, or both.
 *
 * A declaration, not a derivation — nothing in the solver reads it. It answers the question the
 * palette itself cannot: two families can sit on the same ladder with the same constraints and
 * still be meant for different hands. Electric blue is the brand's; a chart hue is the product's.
 * Saying which is authored state, so it lives on the spec beside the hue and travels with the
 * palette through the session, the share link and the markdown export.
 *
 * Stored as a sorted array and dropped entirely when empty, so that "declared nothing" is one
 * shape (`undefined`) rather than two (`undefined` and `[]`) — the dirty check compares JSON,
 * and toggling a scope on and off again must leave the spec exactly as it was.
 */

import type { PaletteSpec } from './types';

export const SCOPES = ['brand', 'product'] as const;
export type Scope = (typeof SCOPES)[number];

/** How a scope reads on screen. The word "design" is the caption's, not the pill's. */
export const SCOPE_LABEL: Record<Scope, string> = { brand: 'Brand', product: 'Product' };

export function isScope(value: unknown): value is Scope {
    return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

/** A valid `scope` field: absent, or an array of known scopes. */
export function isScopeList(value: unknown): value is Scope[] | undefined {
    return value === undefined || (Array.isArray(value) && value.every(isScope));
}

/** Sorted in `SCOPES` order, deduplicated, and `undefined` when empty. */
export function normaliseScopes(scopes: readonly Scope[] | undefined): Scope[] | undefined {
    if (!scopes) return undefined;
    const out = SCOPES.filter((s) => scopes.includes(s));
    return out.length ? [...out] : undefined;
}

/** The declared scopes of a family, grey included. Always an array, for rendering. */
export function familyScopes(spec: PaletteSpec, family: string): Scope[] {
    const scope =
        family === 'grey'
            ? spec.grey.scope
            : spec.chromatic.families.find((f) => f.id === family)?.scope;
    return normaliseScopes(scope) ?? [];
}

/** Write a family's scopes onto a draft spec, normalised. Grey included. */
export function setFamilyScopes(
    draft: PaletteSpec,
    family: string,
    scopes: readonly Scope[],
): void {
    const next = normaliseScopes(scopes);
    if (family === 'grey') {
        if (next) draft.grey.scope = next;
        else delete draft.grey.scope;
        return;
    }
    const f = draft.chromatic.families.find((x) => x.id === family);
    if (!f) return;
    if (next) f.scope = next;
    else delete f.scope;
}

/**
 * The caption under a family's name: `brand & product design`, `brand design`,
 * `product design`, or nothing when nothing is declared.
 */
export function scopeSentence(scopes: readonly Scope[]): string | null {
    const s = normaliseScopes(scopes);
    if (!s) return null;
    return `${s.map((x) => SCOPE_LABEL[x].toLowerCase()).join(' & ')} design`;
}
