/**
 * One store, and almost all of it is derived.
 *
 * The authored state is a single object — `spec`, the five anchors and the parameters that
 * produce the palette. Everything else on this store is computed from it: the 66 solved shades,
 * the token graph they resolve through, the dirty flag. Storing a solved palette would mean
 * trusting a snapshot of a computation instead of recomputing it, which is the one thing this
 * tool exists not to do.
 *
 * ## What this replaces
 *
 * `agorapulse-color-lab`'s store is 1058 lines, because it also held a migration plan across 64
 * components, per-component reference exceptions, proposed token names, a component preview with
 * its fixture and forced state, a V2→V3 remap simulation, and a contrast-pair audit. Twenty-odd
 * fields, and `rebuild()` recomputed FOUR things on every anchor nudge.
 *
 * Two of those four survive here — `graphWithAdditions` and `resolveGraph` — because the
 * "Given, not solved" tray reads brand and chart hexes out of the graph and the exports need
 * `cssVar`. The other two went with their data: `deriveV2ToV3Remap` needed
 * `vendor/manifest.json`'s leak audit, and the contrast flips needed
 * `vendor/contrast-pairs.json`. Neither is vendored here.
 */

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { solvePalette } from '../engine/solve';
import type { PaletteSolution, PaletteSpec } from '../engine/types';
import { loadGraph } from '../model/load';
import { resolveGraph, type Resolved } from '../model/resolve';
import { graphWithAdditions } from '../model/synthetic';
import type { NodeId, TokenGraph } from '../model/types';

import baselineSpec from '../../spec/palette.baseline.json';

/**
 * The vendored snapshot, built once at module load.
 *
 * `loadGraph` reads the token JSON through `import.meta.glob(..., { eager: true })`, so this is
 * a synchronous parse of inlined data rather than a fetch — the app cannot boot with a
 * half-loaded graph.
 */
export const graph: TokenGraph = loadGraph();

export const BASELINE_SPEC = baselineSpec as unknown as PaletteSpec;
export const BASELINE_SOLUTION = solvePalette(BASELINE_SPEC);
export const BASELINE_RESOLVED = resolveGraph(graphWithAdditions(graph, BASELINE_SOLUTION, []), {
    solution: BASELINE_SOLUTION,
    aliasOverrides: new Map(),
});

/** Serialised once, for the dirty check below. */
const BASELINE_SPEC_JSON = JSON.stringify(BASELINE_SPEC);

export type ThemeMode = 'light' | 'dark' | 'system';
export type WallView = 'edit' | 'figma';

/** What a rehydrated session brought back. */
export interface RestoreReport {
    specChanged: boolean;
    /** The saved palette no longer solves, so it was dropped rather than applied. */
    paletteDropped: boolean;
}

export interface AppState {
    // ---------------------------------------------------------------- authored
    /** The only persisted field. Everything below is derived from it. */
    spec: PaletteSpec;

    // ------------------------------------------------------------------ history
    /**
     * Specs to go back to, oldest first. NOT persisted.
     *
     * The tool used to offer exactly one recovery — `Reset palette`, back to the shipped
     * baseline — for an action that moves up to 49 of the 66 shades. So the only way to take
     * back one anchor nudge was to discard the whole palette, and both confirmations on the
     * page exist because of that: Nielsen's third heuristic is that undo BEATS "are you
     * sure?", and this had the second without the first.
     *
     * A history is cheap here for the same reason the store is small: `spec` is the entire
     * authored state, so a step is one `structuredClone` of a plain-JSON object.
     *
     * Deliberately not persisted. A reload restores your palette, and a history that survived
     * it would let you undo past the point the session started — into work the notice said
     * nothing about.
     */
    past: PaletteSpec[];
    /** Specs undone but not yet superseded, most recently undone first. */
    future: PaletteSpec[];

    // ----------------------------------------------------------------- derived
    solution: PaletteSolution;
    graph: TokenGraph;
    resolved: Resolved;
    /** Cached rather than computed per read — see `isSpecDirty`. */
    specDirty: boolean;
    /**
     * Bumped on every solve.
     *
     * The palette wall writes 66 custom properties onto one element in a `useLayoutEffect`
     * instead of re-rendering 66 components, so it needs something to depend on. `solution` is
     * a new object each time, but the wall reads it through `getState()` inside the effect —
     * this counter is what schedules the effect.
     */
    revision: number;

    // -------------------------------------------------------------------- view
    /** `ref.palette.<family>.<rung>` — which swatch has its inspector open. */
    selectedToken: NodeId | null;
    /**
     * What the wall shows: the palette being edited, or what Figma exports for the same cells.
     *
     * A VIEW, not authored state — it changes nothing in the spec and is not persisted. The
     * Figma view is read-only, and switching to it closes the inspector, because an open
     * editor over values you cannot edit is a promise the screen cannot keep.
     */
    wallView: WallView;
    /**
     * True while a slider or colour picker is being dragged.
     *
     * Read in two places, both to stop something from fighting the pointer: the wall drops its
     * 240ms staggered swatch transition, and `updateSpec` swallows its refusal toast.
     */
    dragging: boolean;
    theme: ThemeMode;
    toast: string | null;
    restored: RestoreReport | null;
    /** A write to localStorage has failed at least once this session. */
    storageBroken: boolean;

    // ----------------------------------------------------------------- actions
    updateSpec: (mutate: (draft: PaletteSpec) => void) => void;
    selectToken: (id: NodeId | null) => void;
    setWallView: (view: WallView) => void;
    setDragging: (dragging: boolean) => void;
    setTheme: (theme: ThemeMode) => void;
    say: (message: string) => void;
    dismissRestored: () => void;
    /** Back to the shipped palette. */
    resetPalette: () => void;
    /** One step back through `past`. A no-op when it is empty. */
    undo: () => void;
    /** One step forward through `future`. A no-op when it is empty. */
    redo: () => void;
}

/**
 * The effective graph and the resolution move as a PAIR.
 *
 * Adding a family produces rungs with no node in the vendored graph, and resolving against the
 * old graph would drop them. Returning both is what lets the tray and the exports see an
 * addition.
 *
 * The third argument to `graphWithAdditions` is always `[]` here. In the source repo it carried
 * `addedTokens`, written by an "add a semantic token" action on a screen that does not exist
 * here — and which had no caller there either.
 */
function rebuild(solution: PaletteSolution) {
    const effective = graphWithAdditions(graph, solution, []);
    return {
        graph: effective,
        resolved: resolveGraph(effective, { solution, aliasOverrides: new Map() }),
    };
}

const cloneSpec = (spec: PaletteSpec): PaletteSpec => structuredClone(spec);

/**
 * Cached because this is read AS A ZUSTAND SELECTOR.
 *
 * Zustand runs a selector on every notification to compare its result, so a
 * `JSON.stringify(spec) !== JSON.stringify(BASELINE_SPEC)` living in the selector serialised
 * the whole spec twice per store update. During a slider drag that was several full spec
 * serialisations per frame, every result discarded immediately.
 *
 * The comparison is still the honest test — a spec edited back to the baseline should count as
 * clean — so it is kept, and computed once per spec change instead of once per read.
 */
function isSpecDirty(spec: PaletteSpec): boolean {
    return JSON.stringify(spec) !== BASELINE_SPEC_JSON;
}

// ------------------------------------------------------------- persistence ----

type PersistedSession = Pick<AppState, 'spec'>;

const SESSION_KEY = 'agorapulse-palette.session';
const SESSION_VERSION = 1;

/**
 * Storage that cannot throw.
 *
 * A quota error or a locked-down profile must not take the app down with it — and must not
 * pretend to have saved either, hence the in-memory fallback plus the `storageBroken` flag the
 * status bar reads.
 */
const fallback = new Map<string, string>();
let storageFailed = false;

/**
 * Push the flag into the store the FIRST time a write actually fails.
 *
 * This used to be copied into state once at hydration — before any write had been attempted —
 * so the exact failure the mechanism exists to catch was the one it could not see: a browser
 * that READS fine and fails to WRITE (quota exhausted mid-session, Safari private mode). The
 * status bar kept saying "saved" over work that was going nowhere.
 */
let announceStorageBroken: (() => void) | null = null;

function markStorageBroken() {
    if (storageFailed) return;
    storageFailed = true;
    announceStorageBroken?.();
}

const guardedStorage: StateStorage = {
    getItem: (name) => {
        try {
            return window.localStorage.getItem(name);
        } catch {
            markStorageBroken();
            return fallback.get(name) ?? null;
        }
    },
    setItem: (name, value) => {
        try {
            window.localStorage.setItem(name, value);
        } catch {
            markStorageBroken();
            fallback.set(name, value);
        }
    },
    removeItem: (name) => {
        try {
            window.localStorage.removeItem(name);
        } catch {
            markStorageBroken();
            fallback.delete(name);
        }
    },
};

/**
 * Apply a saved spec only if it still SOLVES.
 *
 * The vendored snapshot moves under a saved session — a constraint target can change, a family
 * can be renamed — and a spec that no longer solves would throw during hydration and blank the
 * app. Dropping it and saying so is the behaviour; silently keeping it is not an option because
 * every derived field would be missing.
 */
function mergeSession(persisted: unknown, current: AppState): AppState {
    const saved = persisted as Partial<PersistedSession> | null | undefined;
    if (!saved?.spec) return current;

    const spec = saved.spec;
    let solution: PaletteSolution;
    try {
        solution = solvePalette(spec);
    } catch {
        return { ...current, restored: { specChanged: false, paletteDropped: true } };
    }

    return {
        ...current,
        spec,
        solution,
        ...rebuild(solution),
        specDirty: isSpecDirty(spec),
        restored: { specChanged: isSpecDirty(spec), paletteDropped: false },
    };
}

// ------------------------------------------------------------------ store ----

/**
 * How deep the history goes.
 *
 * Deep enough that a working session is covered, bounded because every step is a whole spec
 * held in memory. Reaching the cap drops the OLDEST step, so the recent past — the part
 * anybody actually reaches for — is what survives.
 */
const HISTORY_LIMIT = 60;

function initialise(
    set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
    get: () => AppState,
): AppState {
    let toastTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * Whether the current continuous gesture has already recorded its step.
     *
     * Without this a slider drag records one step per pointer move — a single sweep of the
     * chroma handle is a couple of hundred of them — and `undo` stops meaning anything: it
     * would walk back through the frames of one gesture rather than back past the gesture.
     * So a drag records the spec it STARTED from, once, and everything until the handle is
     * released folds into that one step.
     *
     * Reset by `setDragging(true)`, which is raised by every continuous control in the app:
     * the three channel sliders and the native colour pickers.
     */
    let gestureRecorded = false;

    return {
        spec: cloneSpec(BASELINE_SPEC),
        past: [],
        future: [],
        solution: BASELINE_SOLUTION,
        graph,
        resolved: BASELINE_RESOLVED,
        specDirty: false,
        revision: 0,

        selectedToken: null,
        wallView: 'edit',
        dragging: false,
        theme: 'dark',
        toast: null,
        restored: null,
        storageBroken: false,

        updateSpec: (mutate) => {
            const spec = cloneSpec(get().spec);
            mutate(spec);

            let solution: PaletteSolution;
            try {
                solution = solvePalette(spec);
            } catch (err) {
                /*
                   A constraint can become unreachable — push grey-1000 light enough and
                   contrast(800, 200) >= 4.5 has no solution, so the bisection refuses rather
                   than returning a quietly wrong ladder.

                   Keeping the last good solution is right, but it MUST be said. A silent no-op
                   looks exactly like a broken app: you move an anchor and nothing happens, with
                   nothing to explain why.

                   EXCEPT while dragging, where a slider fires per pointer move and a refused
                   frame would raise the same four-second toast dozens of times for one gesture,
                   burying the message under copies of itself. Held against the edge the handle
                   simply stops, which says the same thing continuously and in the right place.
                */
                if (get().dragging) return;
                const message = String((err as Error).message).split('\n')[0];
                get().say(
                    message.startsWith('grey rung')
                        ? 'Rejected: no grey scale satisfies contrast(800, 200) at that anchor'
                        : message.startsWith('rung 200')
                          ? 'Rejected: no light end satisfies contrast(700, 200) at that anchor'
                          : `Rejected: ${message.slice(0, 90)}`,
                );
                return;
            }

            /*
               The step is recorded HERE, after the solve succeeded, and that ordering is the
               point: a refused edit keeps the last good palette, so recording it would put a
               step in the history that undoing to changes nothing. Undo has to move the
               palette every time, or it reads as broken.
            */
            const dragging = get().dragging;
            const record = !dragging || !gestureRecorded;
            if (dragging) gestureRecorded = true;

            set((s) => ({
                spec,
                solution,
                ...rebuild(solution),
                specDirty: isSpecDirty(spec),
                revision: s.revision + 1,
                past: record ? [...s.past, s.spec].slice(-HISTORY_LIMIT) : s.past,
                /* Any new edit invalidates the redo branch — the standard rule, and the only
                   one that cannot present a "forward" that no longer follows from here. */
                future: record ? [] : s.future,
            }));
        },

        selectToken: (selectedToken) => set({ selectedToken }),
        // The Figma view is read-only, so nothing can stay selected under it.
        setWallView: (wallView) =>
            set(wallView === 'figma' ? { wallView, selectedToken: null } : { wallView }),
        setDragging: (dragging) => {
            // Opening a gesture arms the coalescer; releasing it does not need to.
            if (dragging) gestureRecorded = false;
            set({ dragging });
        },

        /**
         * The theme lives in its OWN storage key, not in `partialize`.
         *
         * `index.html` has to read it synchronously before first paint — a persisted zustand
         * blob is rehydrated after React boots, which is one white frame too late, and on this
         * app that frame is the surface people judge hues against. It is also not session
         * work: resetting the palette should not change somebody's theme.
         */
        setTheme: (theme) => {
            set({ theme });
            const root = document.documentElement;
            const dark =
                theme === 'dark' ||
                (theme === 'system' && !window.matchMedia('(prefers-color-scheme: light)').matches);
            root.classList.toggle('dark', dark);
            try {
                window.localStorage.setItem('agorapulse-palette-theme', theme);
            } catch {
                /* A theme preference is not worth a thrown error. */
            }
        },

        say: (toast) => {
            set({ toast });
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => set({ toast: null }), 4200);
        },

        dismissRestored: () => set({ restored: null }),

        /*
           A reset is undoable, and it still asks first.

           The confirmation stays because it is the one control that discards the whole work
           product in a tool that authors exactly one artefact — that reasoning is unchanged.
           What changes is that saying yes is no longer final: the discarded palette goes onto
           the history like any other step, so "Reset" followed by "actually, no" is one
           keystroke rather than a re-authoring.
        */
        resetPalette: () =>
            set((s) => ({
                spec: cloneSpec(BASELINE_SPEC),
                solution: BASELINE_SOLUTION,
                graph,
                resolved: BASELINE_RESOLVED,
                specDirty: false,
                revision: s.revision + 1,
                restored: null,
                past: [...s.past, s.spec].slice(-HISTORY_LIMIT),
                future: [],
            })),

        undo: () => step(set, get, 'undo'),
        redo: () => step(set, get, 'redo'),
    };
}

/**
 * One step in either direction, because the two are the same move mirrored.
 *
 * Written once rather than twice: the only asymmetry is which stack is popped and which is
 * pushed, and two copies of "recompute every derived field from a spec" is exactly how one of
 * them ends up forgetting `resolved`.
 *
 * A stored spec is re-SOLVED rather than restored alongside a cached solution, for the reason
 * the top of this file gives: trusting a snapshot of a computation is the one thing this tool
 * exists not to do. It also costs nothing here — a solve is ~3ms, and this runs on a keystroke.
 */
function step(
    set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
    get: () => AppState,
    direction: 'undo' | 'redo',
): void {
    const state = get();
    const from = direction === 'undo' ? state.past : state.future;
    if (from.length === 0) return;

    const spec = from[from.length - 1];
    let solution: PaletteSolution;
    try {
        solution = solvePalette(spec);
    } catch {
        /*
           A step that no longer solves is dropped rather than applied, and said.

           It should not be reachable — every spec in the history solved when it was recorded,
           and nothing under it moves within a session. It is here because the alternative is
           the failure `mergeSession` already guards against one layer up: a throw on the way
           in leaves every derived field missing and blanks the app.
        */
        set({
            past: direction === 'undo' ? state.past.slice(0, -1) : state.past,
            future: direction === 'redo' ? state.future.slice(0, -1) : state.future,
        });
        state.say('Rejected: that step no longer solves against this snapshot');
        return;
    }

    set((s) => ({
        spec,
        solution,
        ...rebuild(solution),
        specDirty: isSpecDirty(spec),
        revision: s.revision + 1,
        past:
            direction === 'undo' ? s.past.slice(0, -1) : [...s.past, s.spec].slice(-HISTORY_LIMIT),
        future:
            direction === 'undo'
                ? [...s.future, s.spec].slice(-HISTORY_LIMIT)
                : s.future.slice(0, -1),
    }));
}

export const useStore = create<AppState>()(
    persist<AppState, [], [], PersistedSession>(initialise, {
        name: SESSION_KEY,
        version: SESSION_VERSION,
        storage: createJSONStorage<PersistedSession>(() => guardedStorage),
        /*
           `spec` alone, and that is the whole authored state.

           The source repo persisted six fields; five of them were migration work. No
           `replacer`/`reviver` pair is needed here either — those existed because four of the
           six saved fields were a `Map` or a `Set`, which `JSON.stringify` turns into `{}`.
           A spec is plain JSON.
        */
        partialize: (s) => ({ spec: s.spec }),
        merge: mergeSession,
    }),
);

// Now that there is a store to tell, wire the storage failure to it.
announceStorageBroken = () => useStore.setState({ storageBroken: true });

/**
 * Departures from the shipped palette.
 *
 * A whole spec counts as ONE: forty slider moves are one authored palette, and "Discard 40
 * edits?" for one palette read as a threat to forty things.
 */
export function paletteEditCount(state: AppState): number {
    return state.specDirty ? 1 : 0;
}
