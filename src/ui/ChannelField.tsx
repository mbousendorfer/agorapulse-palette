/**
 * One numeric channel: a slider you can drag and a number you can type, kept in step.
 *
 * Built once and used four times — lightness, chroma and hue in the shade inspector, and the
 * hue in the Add-a-colour dialog, which had its own copy first. The two would have drifted on
 * the first change to the typing behaviour, which is the same reason `componentMark.ts` exists.
 *
 * ## The typing behaviour is the whole reason this is a component
 *
 * A plainly controlled number input cannot be used for this. `Number('')` is 0, so clearing the
 * box to retype snaps the value to the minimum — the slider jumps to one end and, in this app,
 * every shade downstream re-solves to whatever that means. So the typed value is held as TEXT
 * beside the number, and `value` only moves when the text parses.
 *
 * A COMMA is accepted as the decimal separator. `type="number"` renders and accepts the
 * locale's separator, so on a French machine the box reads `0,8571` and a typed `0,86` arrives
 * with a comma — `Number('0,86')` is NaN, so the value silently refused to move. That was seen
 * in a screenshot before it was reasoned about.
 *
 * Clamped to `[min, max]`, never wrapped, and that includes hue where wrapping is arguably more
 * correct (370 deg IS 10 deg). Wrapping misbehaves mid-keystroke: typing "360" passes through
 * "36", then the "0" wraps to 0 and the handle snaps across the track. For hue, 360 and 0 are
 * the same colour, so clamping loses nothing.
 *
 * ## Fixed height, and no hint slot
 *
 * Every row is exactly one line, always. There was a `hint` prop carrying "in ramp scope the
 * ladder sets the lightness", and a row that can grow a line is a row that changes the panel's
 * height while you drag it. The shade inspector opens UPWARD near the bottom of the wall,
 * anchored by its bottom edge, so a height change there moves everything you are looking at.
 * That caveat belongs in the scope note, which already states it.
 *
 * ## onDragChange
 *
 * A range input fires per pointer move, and in this app each move re-solves 66 shades. The
 * store's `dragging` flag is what makes that bearable: `PaletteWall` drops its swatch
 * transition while it is set, and `updateSpec` suppresses its rejection toast — otherwise
 * holding a handle against a constraint edge raises the same four-second toast dozens of times
 * for one gesture. Pass `onDragChange` wherever a commit reaches the spec.
 */

import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function ChannelField({
    label,
    value,
    min,
    max,
    step,
    decimals,
    unit,
    onChange,
    onDragChange,
    className,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    /** Places shown in the box, and the precision the slider reads back at. */
    decimals: number;
    /** Rendered after the box — a degree sign, not part of the value. */
    unit?: string;
    onChange: (next: number) => void;
    onDragChange?: (dragging: boolean) => void;
    className?: string;
}) {
    const [text, setText] = useState(value.toFixed(decimals));
    /*
       Re-seed the text when `value` moves from outside — a slider drag, or the shade under the
       panel being re-solved. Adjusted during render rather than in an effect: React documents
       this for "derive from props but keep it editable", and an effect would cost an extra
       commit on every re-solve, which here is every pointer move.
    */
    const [seed, setSeed] = useState(value);
    if (value !== seed) {
        setSeed(value);
        setText(value.toFixed(decimals));
    }

    const clamp = (n: number) => Math.min(max, Math.max(min, n));

    return (
        <div className={cn('flex h-9 items-center gap-3', className)}>
            <span className="text-muted-foreground w-16 shrink-0 text-xs">{label}</span>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                aria-label={label}
                className="min-w-0 flex-1"
                onChange={(e) => onChange(clamp(Number(e.target.value)))}
                onPointerDown={() => onDragChange?.(true)}
                onPointerUp={() => onDragChange?.(false)}
                /* Keyboard arrows never fire a pointer event, so without this the flag would
                   latch on for a gesture that ends away from the handle. */
                onBlur={() => onDragChange?.(false)}
            />
            <Input
                type="number"
                min={min}
                max={max}
                step={step}
                value={text}
                aria-label={`${label} value`}
                className="h-7 w-[5.5rem] shrink-0 px-2 text-right font-mono !text-xs"
                onChange={(e) => {
                    const raw = e.target.value;
                    setText(raw);
                    const parsed = Number(raw.replace(',', '.'));
                    if (raw.trim() !== '' && Number.isFinite(parsed)) onChange(clamp(parsed));
                }}
                onBlur={() => setText(value.toFixed(decimals))}
                onKeyDown={(e) => e.key === 'Enter' && setText(value.toFixed(decimals))}
            />
            {/* The unit slot is always present, so a channel with one and a channel without
                line their boxes up in the same column. */}
            <span className="text-muted-foreground w-2 shrink-0 text-xs">{unit ?? ''}</span>
        </div>
    );
}
