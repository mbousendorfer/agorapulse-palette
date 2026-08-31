/**
 * Two Tailwind utilities for the same CSS property, in one `className="…"` string.
 *
 * This exists because of a real bug and it is worth stating the shape of it. Moving paint
 * out of `app.css` meant adding utilities to call sites, and a variant's ink has to REPLACE
 * the base ink rather than sit beside it. Written as a raw string, both survive:
 *
 *     className="mark text-foreground text-muted-foreground"
 *
 * and which one wins is decided by the order the two rules happen to appear in the compiled
 * stylesheet, not by the order in the attribute. It silently resolved to the wrong one — a
 * V2 marker rendered in the muted ink meant for the plain marker, with no error anywhere.
 *
 * The fix at the call site is `cn()`, which is `twMerge(clsx(…))`: it drops the earlier of
 * two conflicting utilities, so argument order decides and a later argument overrides. This
 * script is the gate that stops the raw-string form coming back.
 *
 * Scope, deliberately narrow: only unprefixed utilities in a literal `className` string,
 * and only the property groups this codebase actually uses. A variant-prefixed utility
 * (`hover:bg-muted`) does not conflict with its unprefixed form, which is the whole point
 * of having it, so those are excluded by the `(?!.*:)` guard. `cn(…)` calls are not checked
 * because `twMerge` resolves them by construction.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
   One entry per CSS property that more than one utility in this app can set.

   `ok` and `warn` used to appear in three of these groups. They were two tokens this file's
   theme added because the palette had no green and no amber; stock shadcn has neither and the
   tokens are gone, so the groups no longer list them.
*/
const GROUPS = {
    color: /^(?!.*:)text-(foreground|muted-foreground|primary|destructive|background|card-foreground|accent-foreground|primary-foreground|destructive-foreground|inherit)$/,
    background:
        /^(?!.*:)bg-(card|muted|background|accent|primary|popover|input|border|destructive|transparent|foreground|muted-foreground)(\/\d+)?$/,
    'border-color':
        /^(?!.*:)border-(border|input|primary|foreground|muted-foreground|transparent|destructive)(\/\d+)?$/,
    'font-size': /^(?!.*:)text-(xs|sm|base|lg|xl|2xl|3xl)$/,
    'border-radius': /^(?!.*:)rounded(-(sm|md|lg|xl|2xl|full|none))?$/,
    'font-weight': /^(?!.*:)font-(thin|light|normal|medium|semibold|bold|extrabold|black)$/,
    'line-height': /^(?!.*:)leading-(none|tight|snug|normal|relaxed|loose|\d+)$/,
    'font-family': /^(?!.*:)font-(sans|serif|mono)$/,
    'font-style': /^(?!.*:)(italic|not-italic)$/,
};

const files = [];
(function walk(dir) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx$/.test(path)) files.push(path);
    }
})('src');

const findings = [];
for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
        for (const match of line.matchAll(/className="([^"]*)"/g)) {
            const tokens = match[1].split(/\s+/).filter(Boolean);
            for (const [property, pattern] of Object.entries(GROUPS)) {
                const clash = tokens.filter((t) => pattern.test(t));
                if (clash.length > 1) {
                    findings.push({ file, line: i + 1, property, clash });
                }
            }
        }
    });
}

if (findings.length === 0) {
    console.log(`${files.length} components scanned · \x1b[1mno conflicting utilities\x1b[0m`);
    process.exit(0);
}

console.log(`\x1b[1m${findings.length} conflicting class list(s)\x1b[0m\n`);
for (const f of findings) {
    console.log(`  ${f.file}:${f.line}`);
    console.log(`    ${f.property}: ${f.clash.join('  ')}`);
}
console.log(
    '\nTwo utilities for one property in a raw string: the winner is stylesheet order, not\n' +
        'attribute order. Route the element through cn() so the later argument overrides.',
);
process.exit(1);
