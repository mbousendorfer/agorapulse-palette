/**
 * Load the vendored token snapshot into a graph.
 *
 * Vite's `import.meta.glob` with `eager` inlines the JSON at build time, so the
 * app ships as static files with no fetch on boot and no chance of a partially
 * loaded graph.
 *
 * The vendor path is also the Style Dictionary origin file, which is what lets
 * the JSON export write each token back to where it came from.
 */

import { buildGraph } from './graph';
import { parseFiles, type ParsedFile } from './parse';
import type { TokenGraph } from './types';

/** Order matters only for readable diagnostics; resolution is topological. */
const FILE_ORDER = [
    'reference/color.json',
    'reference/palette.json',
    'system/color.json',
    'system/color-surface.json',
    'system/color-text.json',
    'system/color-icon.json',
    'system/color-border.json',
    'system/color-link.json',
    'system/color-data.json',
];

/**
 * Every vendored token file, inlined at build time.
 *
 * Typed rather than left as `unknown`: the whole graph is built from `mod.default`,
 * so an `any` here would switch off type checking for the token tree itself.
 */
const modules = import.meta.glob<{ default: unknown }>('../../vendor/tokens/**/*.json', {
    eager: true,
});

function vendorRelative(key: string): string {
    const i = key.indexOf('vendor/tokens/');
    return i >= 0 ? key.slice(i + 'vendor/tokens/'.length) : key;
}

export function loadTokenFiles(): ParsedFile[] {
    const entries = Object.entries(modules).map(([key, mod]) => ({
        originFile: vendorRelative(key),
        json: mod.default,
    }));

    const rank = (p: string) => {
        const i = FILE_ORDER.indexOf(p);
        return i === -1 ? FILE_ORDER.length + 1 : i;
    };
    return entries.sort(
        (a, b) =>
            rank(a.originFile) - rank(b.originFile) || a.originFile.localeCompare(b.originFile),
    );
}

export function loadGraph(): TokenGraph {
    const files = loadTokenFiles();
    const { nodes, diagnostics } = parseFiles(files);
    return buildGraph(nodes, diagnostics);
}

export interface RefSnapshot {
    ref: string;
    commit: string;
    subject: string;
    leakAudit: LeakAudit;
    forceStates: ForceStates;
}

export interface LeakAudit {
    total: number;
    buckets: Record<string, number>;
    v2Names: Record<string, number>;
    v2DistinctCount: number;
}

export interface ForceStates {
    converted: number;
    skipped: number;
    srcStates: number;
    outStates: number;
    coverage: number;
}

/*
   `manifest` used to be exported from here — the sync script's record of which
   design-system commit the snapshot was taken from, its file list and its leak audit.

   It is gone with `vendor/manifest.json`, which this tool does not vendor. Everything that
   read it belonged to the migration workbench: the status bar's "branch 69d2d07 / up to
   date" chip, the preview iframe, and the V2-remap simulation. What survives of that idea
   here is the fidelity test — if the design system moves, the 66 hexes stop matching and it
   names the shade.
*/
