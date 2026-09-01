/**
 * Three sliders in a space you choose, over one hex.
 *
 * Built once and used twice — the shade inspector and the Add-a-colour dialog. That is the
 * whole reason it exists as a file: Add-a-colour used to offer a two-way switch between "from
 * a colour I have" (a hex box) and "from a hue" (one slider), so the same intention was
 * expressed two different ways depending on whether the family existed yet, and the dialog
 * could not do the thing the inspector does best — nudge a channel and watch the consequence.
 * Two implementations of "edit a colour" is how one of them ends up with fewer channels than
 * the other, which is exactly what had happened.
 *
 * ## The space is a CHOICE, and naming it is what keeps the panel honest
 *
 * Both triples describe the same colour and none of their numbers agree: #ada8f2 is
 * OKLCH L 0.7645 / C 0.1051 / H 286.7 and HSL 244 / 74% / 80%. Two lightnesses and two hues,
 * neither wrong. Showing one triple at a time under its own name is why this is a switch
 * rather than six sliders.
 *
 * OKLCH is the default because the ladder IS a ladder in OKLab: a step here is a step the
 * engine reasons about, which is the whole reason the palette is solvable rather than drawn.
 * HSL is here because it is what Figma, most pickers and most CSS say, so it is what people
 * have to hand — but nudging HSL lightness does not move a rung by a predictable perceptual
 * step, and the hint beside the switch says so.
 *
 * ## Why both triples are held as state
 *
 * Not a performance point, a correctness one. `oklchToHex` is not injective at 8 bits —
 * `#F9F9FA` read as L/C/H and written back lands on `#F8F9FA`. Deriving the channels from the
 * hex on every render would feed that 1-LSB drift back into the sliders, so a hue drag would
 * slowly walk the lightness. Holding the triple as the source of truth while the sliders are
 * in use, and writing hex OUT, keeps the drift to the single conversion at the end.
 *
 * `hexToHsl` rounds to the integers a designer types, so it loses more than the OKLCH round
 * trip does. What that rounding does was measured rather than assumed: sweeping hue
 * 120 → 200 → 120 in 4-degree steps, committing on every step, leaves saturation and lightness
 * exactly where they started. What you DO see is one step at the start — the shipped `#ada8f2`
 * rounds to 74% saturation and the first hex committed from it rounds back to 75% — and that is
 * the rounding being honest rather than drifting. The sliders always describe the committed
 * hex, which is the invariant worth keeping in a tool whose output is the hex.
 */

import { useState } from 'react';

import { Segmented, SegmentedItem } from './Segmented';
import { ChannelField } from './ChannelField';

import { hexToHsl, hslToHex } from '../color/hsl';
import { hexToOklch, inGamut, oklchToHex } from '../color/oklab';

/**
 * How many colours a track gradient is sampled at.
 *
 * Nine, and the ceiling matters more than the exact figure: every one of these rebuilds on
 * every pointer move, three tracks at a time, while the same move is re-solving 66 shades. The
 * frame budget belongs to the solve. Browsers interpolate between the stops in sRGB, which is
 * close enough over a ninth of a range that no eye finds the seams — the track is a picture of
 * the direction the handle travels, not a colour read-out.
 */
const TRACK_STOPS = 9;

/**
 * Sweep one channel and paint the result along the track.
 *
 * The other two channels are held exactly where they are, so the gradient answers the only
 * question the handle can pose: what happens if I move THIS one. `oklchToHex` and `hslToHex`
 * both clamp into sRGB, so an out-of-gamut stretch shows as the flat edge of the space rather
 * than as a gap — which is the honest picture: past that point the handle stops changing the
 * colour, and the constraint chip below says so in words.
 */
function trackOf(at: (t: number) => string): string {
    const stops: string[] = [];
    for (let i = 0; i < TRACK_STOPS; i++) stops.push(at(i / (TRACK_STOPS - 1)));
    return `linear-gradient(to right, ${stops.join(', ')})`;
}

export function ChannelEditor({
    /** The colour the sliders describe. Re-seeds both triples when it moves from outside. */
    hex,
    /**
     * Called with a new hex on every channel move.
     *
     * `inGamut` is about the triple the SLIDERS describe, not about the hex — which is always
     * in gamut, because `oklchToHex` clamps. Only this component knows the requested value, so
     * only it can tell a caller that the hex it just received is a clamp rather than the
     * colour asked for. Handed over synchronously with the value rather than through a
     * separate callback, so a caller cannot render a stale verdict beside a fresh hex.
     */
    onChange,
    /**
     * Set while a slider is held, where a caller has a live re-solve to protect.
     *
     * The inspector passes the store's setter: a range input fires per pointer move and each
     * one re-solves 66 shades, so the flag is what drops the swatch transition and silences
     * the rejection toast for refused frames. Add-a-colour passes nothing, because nothing
     * there reaches the spec until Add is pressed.
     */
    onDragChange,
}: {
    hex: string;
    onChange: (hex: string, meta: { inGamut: boolean }) => void;
    onDragChange?: (dragging: boolean) => void;
}) {
    /* View state, so it resets with the panel rather than persisting. Someone who thinks in
       HSL will switch once per colour, which is cheaper than a preference nobody remembers
       setting. */
    const [space, setSpace] = useState<'oklch' | 'hsl'>('oklch');

    const [lch, setLch] = useState(() => {
        try {
            return hexToOklch(hex);
        } catch {
            return { L: 0, C: 0, H: 0 };
        }
    });
    const [hsl, setHsl] = useState(() => {
        try {
            return hexToHsl(hex);
        } catch {
            return { h: 0, s: 0, l: 0 };
        }
    });

    /*
       Re-seed when the colour underneath the sliders moves.

       Adjusted during render rather than in an effect: this is the pattern React documents for
       "derive from props but keep it editable", and an effect would cost an extra commit on
       every re-solve — which, in the inspector, is every pointer move.

       In the inspector the re-seed is load-bearing rather than incidental: a `ramp` commit
       lands the rung at the ladder's lightness rather than at the hex you typed, and the
       sliders have to show where it actually landed.
    */
    const [seed, setSeed] = useState(hex);
    if (hex !== seed) {
        setSeed(hex);
        try {
            setLch(hexToOklch(hex));
            setHsl(hexToHsl(hex));
        } catch {
            /* An unparseable hex should not be the thing that throws during a re-seed. */
        }
    }

    /* One writer per space: move the channel, derive the hex, hand it up. Both land in the
       caller's `onChange`, so a slider in either space cannot diverge from what typing a hex
       does — including the refusal path, where the caller keeps the last good value and the
       handle simply stops. */
    const setLchChannel = (next: { L: number; C: number; H: number }) => {
        setLch(next);
        onChange(oklchToHex(next.L, next.C, next.H), {
            inGamut: inGamut(next.L, next.C, next.H),
        });
    };

    /* HSL cannot leave sRGB: it is a transform OF sRGB, so every triple it can express is
       inside the gamut by construction. Reporting `true` is a fact here, not a default. */
    const setHslChannel = (next: { h: number; s: number; l: number }) => {
        setHsl(next);
        onChange(hslToHex(next), { inGamut: true });
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
                <Segmented
                    type="single"
                    size="sm"
                    value={space}
                    onValueChange={(v) => v && setSpace(v as typeof space)}
                    aria-label="Channel space"
                >
                    <SegmentedItem
                        value="oklch"
                        className="px-2 font-mono text-xs"
                        title="Perceptual — the space the ladder is built in"
                    >
                        OKLCH
                    </SegmentedItem>
                    <SegmentedItem
                        value="hsl"
                        className="px-2 font-mono text-xs"
                        title="CSS sRGB — what a picker or a stylesheet will hand you"
                    >
                        HSL
                    </SegmentedItem>
                </Segmented>
                <span className="text-muted-foreground text-xs">
                    {space === 'oklch'
                        ? 'a step here is a step the engine understands'
                        : 'sRGB — a step here is not a perceptual step'}
                </span>
            </div>

            {space === 'oklch' ? (
                <>
                    <ChannelField
                        label="Lightness"
                        value={lch.L}
                        min={0}
                        max={1}
                        step={0.001}
                        decimals={4}
                        track={trackOf((t) => oklchToHex(t, lch.C, lch.H))}
                        onChange={(L) => setLchChannel({ ...lch, L })}
                        onDragChange={onDragChange}
                    />
                    {/* Chroma's ceiling is 0.37, which is past sRGB everywhere. Callers say
                        when the value being shown has been clamped, rather than the slider
                        pretending the top of its track is reachable. */}
                    <ChannelField
                        label="Chroma"
                        value={lch.C}
                        min={0}
                        max={0.37}
                        step={0.001}
                        decimals={4}
                        /* The flat stretch at the right-hand end is the sRGB boundary, and
                           showing it is better than a slider that pretends the top of its
                           track is reachable. `oklchToHex` clamps, so the gradient simply
                           stops changing where the space runs out. */
                        track={trackOf((t) => oklchToHex(lch.L, t * 0.37, lch.H))}
                        onChange={(C) => setLchChannel({ ...lch, C })}
                        onDragChange={onDragChange}
                    />
                    <ChannelField
                        label="Hue"
                        value={lch.H}
                        min={0}
                        max={360}
                        step={0.1}
                        decimals={1}
                        unit="°"
                        /* 13 stops on hue, not 9: a full turn through every hue at one
                           lightness is the widest sweep of the six, and at 9 the interpolation
                           visibly cuts the corner between blue and magenta. */
                        track={`linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) =>
                            oklchToHex(lch.L, lch.C, (i / 12) * 360),
                        ).join(', ')})`}
                        onChange={(H) => setLchChannel({ ...lch, H })}
                        onDragChange={onDragChange}
                    />
                </>
            ) : (
                /* Hue first, because that is the order HSL is written in and the order every
                   picker shows. The OKLCH group above starts with lightness for the same
                   reason: it is the order the ladder is built in. */
                <>
                    <ChannelField
                        label="Hue"
                        value={hsl.h}
                        min={0}
                        max={360}
                        step={1}
                        decimals={0}
                        unit="°"
                        track={`linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) =>
                            hslToHex({ ...hsl, h: (i / 12) * 360 }),
                        ).join(', ')})`}
                        onChange={(h) => setHslChannel({ ...hsl, h })}
                        onDragChange={onDragChange}
                    />
                    <ChannelField
                        label="Saturation"
                        value={hsl.s}
                        min={0}
                        max={100}
                        step={1}
                        decimals={0}
                        unit="%"
                        track={trackOf((t) => hslToHex({ ...hsl, s: t * 100 }))}
                        onChange={(s) => setHslChannel({ ...hsl, s })}
                        onDragChange={onDragChange}
                    />
                    <ChannelField
                        label="Lightness"
                        value={hsl.l}
                        min={0}
                        max={100}
                        step={1}
                        decimals={0}
                        unit="%"
                        track={trackOf((t) => hslToHex({ ...hsl, l: t * 100 }))}
                        onChange={(l) => setHslChannel({ ...hsl, l })}
                        onDragChange={onDragChange}
                    />
                </>
            )}
        </div>
    );
}
