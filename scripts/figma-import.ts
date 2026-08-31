/**
 * Vendor the Figma variables export so the app can show it.
 *
 * Reads `figma-variables/*.zip` — the three collections as exported from Figma — and writes
 * one `vendor/figma-variables.json`. Written in TypeScript and run through `vite-node` so it
 * shares `src/figma/unzip.ts` and `src/figma/parse.ts` with the browser: the parsing rules
 * are subtle enough (three different join keys, an alias that lives outside `$value`, a
 * hand-typed field with a comment in it) that a second implementation would drift.
 *
 * This does NOT touch `vendor/tokens`. The Figma export and the shipped CSS disagree about
 * more than values — the reference palette is on a different rung scale entirely — so it is
 * vendored ALONGSIDE the token graph as a thing to compare against, never merged into it.
 *
 * Usage: `npm run figma`
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
    collectionOf,
    parseTokensFile,
    resolveValues,
    type FigmaCollection,
    type FigmaToken,
} from '../src/figma/parse';
import { readZipJson } from '../src/figma/unzip';

const IN_DIR = 'figma-variables';
const OUT = 'vendor/figma-variables.json';

/**
 * The mode to import.
 *
 * System and Component each ship `Default` and `Accessible`. The app's model holds one value
 * per token, so importing both would need a mode-aware graph; `Default` is the mode that
 * corresponds to the CSS actually shipped. Reference has a single mode under its own name, so
 * a file that matches nothing here is taken when it is the only one.
 */
const MODE = 'Default';

interface Collected {
    collection: FigmaCollection;
    mode: string;
    tokens: FigmaToken[];
    skipped: Array<{ figmaPath: string; reason: string }>;
}

function pickMode(entries: Array<{ name: string; text: string }>): { name: string; text: string } {
    if (entries.length === 1) return entries[0];
    const wanted = entries.find((e) => basename(e.name, '.tokens.json') === MODE);
    if (wanted) return wanted;
    throw new Error(
        `Expected a "${MODE}.tokens.json" among ${entries.map((e) => e.name).join(', ')}.`,
    );
}

async function main(): Promise<void> {
    const zips = readdirSync(IN_DIR).filter((f) => f.toLowerCase().endsWith('.zip'));
    if (zips.length === 0) throw new Error(`No .zip in ${IN_DIR}/.`);

    const collected: Collected[] = [];

    for (const file of zips) {
        const collection = collectionOf(basename(file, '.zip'));
        if (!collection) {
            console.warn(
                `  skipped ${file} — its name says neither reference, system nor component.`,
            );
            continue;
        }
        const buffer = readFileSync(join(IN_DIR, file));
        const entries = await readZipJson(
            buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        );
        const chosen = pickMode(entries);
        const { tokens, skipped } = parseTokensFile(JSON.parse(chosen.text), collection);
        collected.push({
            collection,
            mode: basename(chosen.name, '.tokens.json'),
            tokens,
            skipped,
        });
    }

    /* Same-collection aliases export with no value — see `resolveValues`. Done here, once,
       so the vendored file is self-describing and the UI never has to walk a chain. */
    resolveValues(collected);

    collected.sort((a, b) => {
        const order: FigmaCollection[] = ['reference', 'system', 'component'];
        return order.indexOf(a.collection) - order.indexOf(b.collection);
    });

    writeFileSync(
        OUT,
        `${JSON.stringify(
            {
                _comment:
                    'Written by `npm run figma` from figma-variables/*.zip. Vendored ALONGSIDE ' +
                    'vendor/tokens, never merged into it: the Figma export and the shipped CSS ' +
                    'disagree about names and rung scales, and that disagreement is the point.',
                mode: MODE,
                collections: collected,
            },
            null,
            2,
        )}\n`,
    );

    console.log(`\n\x1b[1mFigma variables\x1b[0m → ${OUT}`);
    for (const c of collected) {
        const colours = c.tokens.filter((t) => t.type === 'color');
        const aliased = c.tokens.filter((t) => t.aliasOf);
        console.log(
            `  ${c.collection.padEnd(10)} ${String(c.tokens.length).padStart(4)} tokens · ` +
                `${String(colours.length).padStart(3)} colours · ${String(aliased.length).padStart(3)} aliased` +
                (c.skipped.length ? ` · \x1b[33m${c.skipped.length} unnameable\x1b[0m` : ''),
        );
    }
}

main().catch((err: unknown) => {
    console.error(`\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m`);
    process.exitCode = 1;
});
