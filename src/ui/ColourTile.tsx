/**
 * One colour, and the ONE way this app draws one.
 *
 * ## What was wrong
 *
 * Three places show a set of colours — the palette wall, the given-not-solved values, and the
 * Figma collections — and the last two already went through this component, so it looked
 * shared. It was not. The wall's presentation lived in Tailwind classes at ITS call site and
 * this component had none, so the same colour was drawn two different ways. Measured on the
 * built page, side by side:
 *
 *                     wall            these tiles
 *   corner radius     6px             0px
 *   family            ui-monospace    Geist (the sans)
 *   size              12px            14px
 *   line height       16.5px          21px
 *   head weight       600             400
 *   head tracking     0.3px           normal
 *   hex tracking      0.6px           normal
 *
 * Seven differences for two things that mean the same thing. The hex read-outs did not even
 * line up in a column, because only one of the two was monospaced.
 *
 * ## The fix
 *
 * The face is a class table exported from here, and BOTH call sites use it — the same shape as
 * `Segmented`'s `TRACK`/`PILL` and `componentMark`'s glyph table. The wall adds its behaviour
 * on top: it is a `<button>` with a hover ring, a pressed state, a clamp notch and a mark. What
 * it may not add is a different typeface.
 *
 * ## Behaviour is NOT shared, and that half really was broken
 *
 * `app.css` carried two separate `.swatch` rules, the second one written for the wall but
 * SELECTED UNSCOPED — so its 240ms colour transition, its hover lift and its 2px foreground
 * ring all reached these tiles. This file's docblock used to claim `.figma-tile` "takes both
 * off"; it took off `cursor: pointer` and nothing else, so a tile you cannot click lifted and
 * ringed under the pointer. That is the precise thing the claim said it avoided. The
 * interactive rules are scoped to `.wall .swatch` now.
 */

import { prefersDarkInk } from '../color/oklab';

/**
 * The face, shared by the wall's swatch and by every read-only tile.
 *
 * `font-mono` is load-bearing rather than stylistic: these grids exist to be read down a
 * column, and 66 hex values in a proportional face do not line up. It now resolves to a
 * declared face rather than to whatever `ui-monospace` meant on the reader's platform — see
 * the deviation note in `theme.css`.
 *
 * SQUARE, and that is the plate's doing. `rounded-sm` was here, which is right for a tile
 * floating in a gutter and wrong for a sample abutting its neighbour: rounded corners in a
 * 1px-gutter field leave four little diamonds of background at every intersection, so the
 * hairline grid reads as dotted. The read-only tiles square off with it, because one shape
 * language across three grids is the point of this file existing.
 */
export const SWATCH_FACE = 'swatch font-mono text-xs leading-snug';

/** The identity line — a rung on a ladder, a name elsewhere. */
export const SWATCH_HEAD = 'swatch-rung font-mono text-xs leading-none font-semibold tracking-wide';

/** The read-out. Quieter than the head by opacity, which `app.css` owns. */
export const SWATCH_HEX = 'swatch-hex text-xs tracking-wider';

export function ColourTile({
    /** What identifies this colour in its row — a rung on a ladder, a name elsewhere. */
    head,
    hex,
    title,
    /** Draws the corner notch: this name is in Figma but not in the compiled CSS. */
    absent = false,
}: {
    head: string;
    hex: string;
    title?: string;
    absent?: boolean;
}) {
    /* The ink has to be chosen per tile: these sets run from near-white to near-black, and one
       fixed foreground would be illegible at one end or the other. */
    const light = prefersDarkInk(hex);
    return (
        <div
            className={`${SWATCH_FACE} figma-tile ${light ? 'light' : 'dark'}${absent ? ' figma-tile-new' : ''}`}
            style={{ ['--swatch' as string]: hex }}
            title={title}
        >
            <span className={SWATCH_HEAD}>{head}</span>
            <span className="swatch-foot">
                <span className={SWATCH_HEX}>{hex.replace('#', '')}</span>
            </span>
        </div>
    );
}
