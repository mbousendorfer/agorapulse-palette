/**
 * Replicate Style Dictionary's `name/cti/kebab` transform.
 *
 * This has to be exact. Every custom property the app emits is matched against
 * the CSS the design system already ships, and a single mis-derived name means
 * a token silently stops reaching its component.
 *
 * The rule, established empirically against all 808 names in
 * vendor/css/desktop_variables.css and asserted in __tests__/cssName.test.ts:
 *
 *   join the token path with '-', split camelCase boundaries, lowercase.
 *
 * Note this is NOT lodash `kebabCase`, which is the obvious guess. lodash
 * splits digit runs from letter runs, so it would turn the real
 * `--ref-color-mermaid-gradient-from40` into `...-gradient-from-40`. It would
 * also mangle `grey.05`. The camelCase split is the only word-breaking the
 * real transform does.
 */

/** `['ref','palette','electricBlue','500']` -> `ref-palette-electric-blue-500` */
export function cssNameFromPath(path: readonly string[]): string {
    return path
        .join('-')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase();
}

/** Same, with the leading `--`. */
export function cssVarFromPath(path: readonly string[]): string {
    return `--${cssNameFromPath(path)}`;
}
