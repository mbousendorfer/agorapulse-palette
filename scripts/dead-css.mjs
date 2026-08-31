/**
 * Which class selectors in `app.css` nothing can reach any more.
 *
 *   npm run dead-css
 *   npm run dead-css -- --write     (delete them)
 *
 * The app is being moved onto shadcn one screen at a time, and every screen converted
 * strands more of the 3000-line stylesheet. Stranded CSS is not harmless: the next
 * person to change a colour has to read it to find out it never applies.
 *
 * Two things this gets right that eyeballing does not:
 *
 * COMMENTS ARE STRIPPED FROM BOTH SIDES FIRST. This codebase names its own classes in
 * prose constantly — `App.tsx` says "that chain is the whole mental model", which kept
 * `.chain` looking alive. A grep over raw text under-reports the dead by a third.
 * The stylesheet needs the same treatment in the other direction, and for a long time
 * did not get it: `.csslens-raw`, `.dock`, `.dock-body` and `.dock-hidden` were reported
 * dead for months while being mentioned only in CSS comments — four names in a list of
 * five, none of which was ever a selector. Over-reporting is the worse failure of the
 * two, because it is the one that teaches you to skim the output.
 *
 * ANY dead class kills a selector, not all of them. Every class a selector names is a
 * requirement, in a compound (`.insp-effect.narrow`) and across a combinator
 * (`.shell.rail-collapsed .rail-item`) alike. If one is never emitted the selector can
 * never match, so `.insp-effect.narrow` goes even though `.insp-effect` is alive.
 *
 * Deliberately NOT part of `npm run verify`. Mid-conversion a rule is legitimately dead
 * for as long as it takes to finish the screen, and a check that fails then would just
 * be switched off.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'src/ui/app.css');
const WRITE = process.argv.includes('--write');

const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );

/** Blank out comments so prose naming a class cannot keep it alive. */
const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');

/**
 * Same idea, applied to the STYLESHEET.
 *
 * Only block comments: `//` is not a CSS comment, and treating it as one would eat
 * the rest of any line containing a `url(https://…)`.
 *
 * The mirror of the source-side strip above, and it was missing. This file's own
 * docblock leads with "comments are stripped from the sources first" and then scanned
 * the CSS raw, so any `.word` written in a CSS comment became a phantom class that
 * nothing could ever reach — `See PaletteCurves.tsx` reported a dead `.tsx`. A checker
 * with a false positive is a checker people learn to skim past, which costs more than
 * the rule it was protecting.
 */
const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ');

function usedNames() {
    const code = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))]
        .filter((f) => /\.(tsx|ts|mjs)$/.test(f) && !f.endsWith('dead-css.mjs'))
        .map((f) => stripComments(readFileSync(f, 'utf8')))
        .join('\n');
    return code;
}

/** Top-level rules, each carrying the comments and blank lines that precede it. */
function topLevelRules(text) {
    const out = [];
    let depth = 0;
    let cursor = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) {
                out.push({ from: cursor, to: i + 1, raw: text.slice(cursor, i + 1) });
                cursor = i + 1;
            }
        }
    }
    return out;
}

/**
 * Split a chunk into its lead-in and its selector.
 *
 * The lead-in is the comment block documenting the rule. Keeping them together matters:
 * if the rule goes, the paragraph explaining it goes too, rather than being left to
 * describe something that no longer exists. Splitting the whole chunk on commas — the
 * first version of this — cut those comments in half at their own punctuation.
 */
function splitLeadIn(chunk) {
    const brace = chunk.indexOf('{');
    const head = chunk.slice(0, brace);
    let lastEnd = 0;
    for (const m of head.matchAll(/\/\*[\s\S]*?\*\//g)) lastEnd = m.index + m[0].length;
    const after = head.slice(lastEnd);
    const gap = after.lastIndexOf('\n\n');
    const start = lastEnd + (gap === -1 ? 0 : gap + 2);
    return {
        lead: chunk.slice(0, start),
        selector: chunk.slice(start, brace),
        body: chunk.slice(brace),
    };
}

const css = readFileSync(FILE, 'utf8');
const code = usedNames();

const classes = new Set();
for (const m of stripCssComments(css).matchAll(/\.([a-zA-Z][\w-]*)/g)) classes.add(m[1]);

const dead = new Set();
for (const name of classes) {
    const re = new RegExp(`(?<![\\w-])${name.replace(/-/g, '\\-')}(?![\\w-])`);
    if (!re.test(code)) dead.add(name);
}

const classesIn = (sel) => [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
const unreachable = (sel) => {
    const found = classesIn(sel);
    return found.length > 0 && found.some((c) => dead.has(c));
};

let result = css;
const removed = [];
const trimmed = [];

for (const rule of [...topLevelRules(css)].reverse()) {
    const { lead, selector, body } = splitLeadIn(rule.raw);
    if (selector.trimStart().startsWith('@')) continue;

    const parts = selector
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    if (parts.length === 0) continue;

    const deadParts = parts.filter(unreachable);
    if (deadParts.length === 0) continue;

    if (deadParts.length === parts.length) {
        result = result.slice(0, rule.from) + result.slice(rule.to);
        removed.push(parts.join(', '));
    } else {
        // A mixed list keeps the rule and loses only the dead half; dropping the whole
        // thing would unstyle the live selector sharing it.
        const kept = parts.filter((p) => !unreachable(p));
        result =
            result.slice(0, rule.from) + lead + kept.join(',\n') + body + result.slice(rule.to);
        trimmed.push(`${parts.join(', ')}  →  ${kept.join(', ')}`);
    }
}

console.log(
    `${classes.size} class selectors in app.css · ${classes.size - dead.size} reachable · ` +
        `\x1b[1m${dead.size} dead\x1b[0m`,
);

if (dead.size === 0) {
    console.log('\n\x1b[32m✓\x1b[0m nothing to remove.');
    process.exit(0);
}

console.log('\ndead classes:');
for (const name of [...dead].sort()) console.log(`  .${name}`);
console.log(`\nrules that would go: ${removed.length}`);
for (const r of removed) console.log(`  − ${r}`);
if (trimmed.length) {
    console.log(`selector lists that would be trimmed: ${trimmed.length}`);
    for (const t of trimmed) console.log(`  ~ ${t}`);
}

if (WRITE) {
    // Deletions leave runs of blank lines behind; prettier would fix them, but leaving
    // the file needing a format run makes `verify` fail for a reason unrelated to CSS.
    writeFileSync(FILE, result.replace(/\n{3,}/g, '\n\n'));
    console.log(`\n\x1b[32m✓\x1b[0m written. Run \`npx prettier --write ${'src/ui/app.css'}\`.`);
} else {
    console.log('\nPass --write to remove them.');
}
