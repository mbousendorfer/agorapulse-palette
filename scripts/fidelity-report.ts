/**
 * Human-readable fidelity report. Run with `npm run fidelity`.
 *
 * Same comparison as src/engine/__tests__/fidelity.test.ts, but printed as a
 * table with the derivation chain, so the Provenance panel and this script tell
 * the same story. Exits non-zero on any miss beyond 1 LSB per channel.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { contrastHex, hexDelta, hexToOklch, normaliseHex } from '../src/color/oklab';
import { solvePalette } from '../src/engine/solve';
import type { PaletteSpec } from '../src/engine/types';

const ROOT = resolve(import.meta.dirname, '..');
const quiet = process.argv.includes('--quiet');

const spec: PaletteSpec = JSON.parse(
    readFileSync(resolve(ROOT, 'spec/palette.baseline.json'), 'utf8'),
);
const shipped = JSON.parse(
    readFileSync(resolve(ROOT, 'vendor/tokens/reference/palette.json'), 'utf8'),
).ref.palette as Record<string, Record<string, { value: string }>>;

const FAMILIES = ['grey', 'electricBlue', 'orange', 'green', 'red', 'yellow', 'purple', 'menthol'];

const t0 = performance.now();
const solution = solvePalette(spec);
const solveMs = performance.now() - t0;

interface Row {
    ref: string;
    family: string;
    expected: string;
    got: string;
    worst: number;
    delta: string;
    provenance: string;
    ok: boolean;
}

const rows: Row[] = [];
for (const family of FAMILIES) {
    for (const rung of Object.keys(shipped[family])) {
        const ref = `${family}.${rung}`;
        const expected = normaliseHex(shipped[family][rung].value);
        const solved = solution.rungs.get(ref);
        if (!solved) {
            rows.push({
                ref,
                family,
                expected,
                got: '—',
                worst: 999,
                delta: 'missing',
                provenance: '—',
                ok: false,
            });
            continue;
        }
        const delta = hexDelta(solved.hex, expected);
        const worst = Math.max(...delta.map(Math.abs));
        rows.push({
            ref,
            family,
            expected,
            got: solved.hex,
            worst,
            delta: delta.join('/'),
            provenance: solved.provenance.kind,
            ok: worst <= 1,
        });
    }
}

const d = solution.derived;

if (!quiet) {
    console.log('\n\x1b[1mDerivation chain\x1b[0m');
    console.log('─'.repeat(72));
    console.log(`  1. L700  ← ${d.ladderSources.L700.padEnd(29)}  ${d.L700.toFixed(4)}`);
    console.log(
        `  2. L500  ← mean(${d.ladderSources.L500.join(', ')})`.padEnd(42) + `${d.L500.toFixed(4)}`,
    );
    console.log(`  3. low plateau step = (L500−L700)/2     ${d.lowStep.toFixed(4)}`);
    console.log(
        `  4. L200  ← SOLVED, contrast(700,200)≥4.5 ${d.L200.toFixed(4)}   binding family: \x1b[33m${d.rung200Witness}\x1b[0m`,
    );
    console.log(`  5. high plateau step = (L200−L500)/3    ${d.highStep.toFixed(4)}`);
    console.log(
        `  6. L100  = L200 + step100 (free knob)   ${solution.chromaticLadder[0].toFixed(4)}`,
    );
    console.log(
        `\n  chromatic ladder  ${solution.chromaticLadder.map((v) => v.toFixed(4)).join(' · ')}`,
    );
    console.log(
        `  purple factor     ${d.purpleChromaFactor.toFixed(4)}  (back-solved from its anchor, not chosen)`,
    );
    console.log(
        `\n  grey steps        d1 ${d.greyStep1.toFixed(4)} · d2 ${d.greyStep2.toFixed(4)} · d3 ${d.greyStep3.toFixed(4)} · tail ${d.greyTailStep.toFixed(4)}`,
    );
    console.log(
        `  grey d2²=d1·d3    ${(d.greyStep2 ** 2).toFixed(8)} vs ${(d.greyStep1 * d.greyStep3).toFixed(8)}`,
    );
    console.log(`  grey ladder       ${solution.greyLadder.map((v) => v.toFixed(4)).join(' · ')}`);

    console.log('\n\x1b[1mFidelity vs shipped v3.json\x1b[0m');
    console.log('─'.repeat(72));
    let last = '';
    for (const r of rows) {
        if (r.family !== last) {
            console.log(`\n  ${r.family}`);
            last = r.family;
        }
        const mark = !r.ok
            ? '\x1b[31m✗\x1b[0m'
            : r.worst === 0
              ? '\x1b[32m✓\x1b[0m'
              : '\x1b[33m≈\x1b[0m';
        const status = r.worst === 0 ? 'exact' : `±${r.worst} (${r.delta})`;
        const prov = r.provenance === 'ladder' ? '' : `  \x1b[36m[${r.provenance}]\x1b[0m`;
        console.log(
            `    ${mark} ${r.ref.padEnd(18)} ${r.expected} → ${r.got}  ${status.padEnd(16)}${prov}`,
        );
    }

    // The constraints that sit at zero slack are the fragile surface — worth
    // printing every run, not buried in a panel.
    console.log('\n\x1b[1mConstraints at the shipped values\x1b[0m');
    console.log('─'.repeat(72));
    const hex = (ref: string) => solution.rungs.get(ref)!.hex;
    let worstFamily = '';
    let worstRatio = Infinity;
    for (const f of FAMILIES.filter((x) => x !== 'grey')) {
        const c = contrastHex(hex(`${f}.700`), hex(`${f}.200`));
        if (c < worstRatio) {
            worstRatio = c;
            worstFamily = f;
        }
    }
    const greyC = contrastHex(hex('grey.800'), hex('grey.200'));
    const fmt = (v: number, target: number) => {
        const slack = v - target;
        const tag =
            slack < -0.005
                ? `\x1b[31mVIOLATED ${slack.toFixed(3)}\x1b[0m`
                : Math.abs(slack) <= 0.005
                  ? `\x1b[33mBINDING  ${slack.toFixed(3)}\x1b[0m`
                  : `\x1b[32mok       +${slack.toFixed(3)}\x1b[0m`;
        return `${v.toFixed(3)}  ${tag}`;
    };
    console.log(
        `  C4  contrast(700,200) ≥ 4.5, all families   ${fmt(worstRatio, 4.5)}  witness: ${worstFamily}`,
    );
    console.log(`  C6  contrast(grey 800,200) ≥ 4.5            ${fmt(greyC, 4.5)}`);
    const c100 = FAMILIES.filter((x) => x !== 'grey').map((f) =>
        contrastHex(hex(`${f}.100`), '#FFFFFF'),
    );
    const greyOnWhite = contrastHex(hex('grey.100'), '#FFFFFF');
    console.log(
        `  C5  contrast(100,white) ≈ grey-100's ${greyOnWhite.toFixed(4)}   ` +
            `chromatic ${Math.min(...c100).toFixed(4)}–${Math.max(...c100).toFixed(4)}  ` +
            `\x1b[33mresidual +${(Math.min(...c100) - greyOnWhite).toFixed(4)} — soft, knob is step100\x1b[0m`,
    );
}

const fails = rows.filter((r) => !r.ok);
const exact = rows.filter((r) => r.worst === 0).length;

console.log('\n' + '─'.repeat(72));
console.log(
    `\x1b[1m${rows.length - fails.length}/${rows.length}\x1b[0m rungs within 1 LSB  ` +
        `(${exact} byte-exact, ${rows.length - fails.length - exact} within rounding, ${fails.length} failing)`,
);
console.log(`solvePalette: ${solveMs.toFixed(2)} ms`);

if (fails.length > 0) {
    console.log('\n\x1b[31mFailing rungs\x1b[0m');
    for (const r of fails) {
        console.log(
            `  ${r.ref}: want ${r.expected} (L ${hexToOklch(r.expected).L.toFixed(4)}) ` +
                `got ${r.got}${r.got !== '—' ? ` (L ${hexToOklch(r.got).L.toFixed(4)})` : ''} delta ${r.delta}`,
        );
    }
    process.exit(1);
}
