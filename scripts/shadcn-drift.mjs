/**
 * How far each installed shadcn component has drifted from upstream.
 *
 * This exists because three of them had drifted without anyone noticing, and the drift was
 * invisible in `shadcn add --diff`: this repo prettifies everything it installs, so every
 * file differs from upstream by indentation, quote style and trailing commas, and a real
 * edit is three lines inside three hundred lines of formatting noise. Both sides are run
 * through THIS repo's prettier before comparing, so what is left is what was changed on
 * purpose.
 *
 * The two lines it forgives are the CLI's own doing, not an edit:
 *
 *   - the `@/registry/new-york-v4/ui/x` -> `@/components/ui/x` import rewrite, which
 *     `shadcn add` performs when it installs a file
 *   - `'use client';`, which is meaningless in a Vite SPA (`rsc: false`) and which the CLI
 *     sometimes strips. Every local file carries it anyway, so a re-run is a no-op.
 *
 * A local edit is not automatically wrong. Two were genuinely justified once and had gone
 * stale — `toggle.tsx` pinned its ON state to `bg-primary` because the THEN theme's
 * `--accent` measured 1.45:1 on card, and after the theme changed upstream's `bg-accent`
 * measured better on the number that matters (the label's contrast on its own fill: 10.79:1
 * against the local edit's 4.36:1 in dark, and 4.63:1 against 4.02:1 in light, where only
 * upstream clears AA). The point of this script is that such a claim gets re-checked when
 * the theme moves, instead of outliving the palette it was measured against.
 *
 * Run: `npm run shadcn-drift`. Network required — it reads the live registry.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const LOCAL = 'src/components/ui';
const names = readdirSync(LOCAL)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => f.replace(/\.tsx$/, ''))
    .sort();

const work = mkdtempSync(join(tmpdir(), 'shadcn-drift-'));
const drifted = [];
let checked = 0;

/** Everything the CLI itself rewrites on install, plus formatting, normalised away. */
function normalise(source) {
    return source
        .replace(/@\/registry\/new-york-v4\/ui\//g, '@/components/ui/')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '' && l !== "'use client';" && l !== '"use client"')
        .join('\n');
}

try {
    for (const name of names) {
        let raw;
        try {
            raw = execFileSync('npx', ['shadcn@latest', 'view', `@shadcn/${name}`], {
                encoding: 'utf8',
                maxBuffer: 64 * 1024 * 1024,
                stdio: ['ignore', 'pipe', 'ignore'],
            });
        } catch {
            console.log(`  ? ${name} — not in the registry, or the registry is unreachable`);
            continue;
        }
        const start = raw.indexOf('[');
        if (start < 0) continue;
        const items = JSON.parse(raw.slice(start));
        for (const item of items) {
            for (const file of item.files || []) {
                const base = file.path.split('/').pop();
                if (!names.includes(base.replace(/\.tsx$/, ''))) continue;
                const path = join(work, base);
                writeFileSync(path, file.content);
                /*
                   `--config` is not optional. The work directory is outside the repo, and
                   prettier resolves its config from the FILE's location — so without this it
                   formats to its own defaults (2-space, double quotes) and every component
                   reports as drifted. Cost me one false all-fifteen result.
                */
                execFileSync('npx', ['prettier', '--config', '.prettierrc.json', '--write', path], {
                    stdio: 'ignore',
                });
                const mine = normalise(readFileSync(join(LOCAL, base), 'utf8'));
                const theirs = normalise(readFileSync(path, 'utf8'));
                checked++;
                if (mine !== theirs) {
                    const a = mine.split('\n');
                    const b = theirs.split('\n');
                    const differing = a.filter((l) => !b.includes(l)).length;
                    drifted.push({ base, differing });
                }
            }
        }
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (drifted.length === 0) {
    console.log(`${checked} components checked · \x1b[1mnone drifted from upstream\x1b[0m`);
    process.exit(0);
}

console.log(`\x1b[1m${drifted.length} of ${checked} components differ from upstream\x1b[0m\n`);
for (const d of drifted) {
    console.log(`  ${LOCAL}/${d.base}  — ${d.differing} line(s) not in upstream`);
}
console.log(
    '\nSee what changed with `npx shadcn@latest add <name> --diff`. A local edit is allowed,\n' +
        'but it has to be worth the drift AND still be true of the CURRENT theme — the ones this\n' +
        'script was written for were measured against a palette that had since been replaced.',
);
process.exit(1);
