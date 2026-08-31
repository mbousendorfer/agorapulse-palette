/**
 * Two shapes of "state that follows something else", written once.
 *
 * Both existed five times as `useEffect(() => setX(y), [y])`. That works, and it
 * costs an extra commit every time the thing it follows changes — which for the
 * anchor field is every keystroke, and for the pickers every character of a search.
 * React's own guidance is to adjust state during render for exactly this, and
 * `react-hooks/set-state-in-effect` flags the effect form.
 *
 * Adjusting state during render looks alarming and is not: React re-runs the
 * component immediately, before touching the DOM or running any effect, so nothing
 * downstream ever observes the stale value. It is a cheaper and more honest
 * expression of "this is derived, but still editable".
 */

import { useState, type Dispatch, type SetStateAction } from 'react';

/**
 * State that re-seeds to `initial` whenever `key` changes.
 *
 * Used for the pickers' keyboard cursor (reset to 0 when the query or the open
 * state changes) and for the anchor and hex fields (re-seed when the value
 * underneath them moves because of a reset or a shared link).
 */
export function useResetOn<T>(key: unknown, initial: T): [T, Dispatch<SetStateAction<T>>] {
    const [value, setValue] = useState(initial);
    const [seed, setSeed] = useState(key);
    if (key !== seed) {
        setSeed(key);
        setValue(initial);
    }
    // The full `useState` setter, updater form included: the pickers move their
    // cursor with `setActive((i) => i + 1)`.
    return [value, setValue];
}

/**
 * True once `condition` has been true, and true forever after.
 *
 * The preview keeps the master iframe mounted after the first time it is shown,
 * because the cost is the initial boot: ~140 kB of CSS plus 838 kB of icon masks
 * re-parsed. Unmounting it to save nothing and paying that again on the next
 * comparison is the wrong trade.
 */
export function useLatch(condition: boolean): boolean {
    const [latched, setLatched] = useState(condition);
    if (condition && !latched) setLatched(true);
    return latched;
}
