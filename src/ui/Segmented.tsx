/**
 * A segmented control shaped the way this theme shapes one: a bordered track with a lifted
 * pill inside it.
 *
 * ## Why this file exists rather than a prop on ToggleGroup
 *
 * Neither shipped variant fits. `variant="outline"` gives every item its own border with
 * `border-left: 0`, so a row reads as a strip of divided cells rather than as one control —
 * and under `autoblog`, whose `--radius` was 1.4rem, it measured
 * `border-radius: 20.4px 0 0 20.4px` on the first item and `0px` on the next: a lozenge
 * sliced by straight edges. `variant="default"` avoids that but gives the group no track at
 * all, so its items read as loose words.
 *
 * The answer is not to edit `toggle-group.tsx`. An earlier pass did exactly that, inventing a
 * track inside the component, and it drifted 50 lines from upstream where `shadcn add --diff`
 * could not show it under this repo's own formatting. The app's own preference belongs in the
 * app; `scripts/shadcn-drift.mjs` keeps the components at zero.
 *
 * ## Where the shape comes from
 *
 * The structure is upstream `tabs.tsx`'s — `TabsList`'s `bg-muted rounded-lg p-[3px]` and
 * `TabsTrigger`'s active treatment, transposed from `data-[state=active]` to
 * `data-[state=on]`. Borrowing it means the two controls are indistinguishable on screen,
 * which matters here: the Reference screen stacks a `Segmented` directly above a real `Tabs`,
 * and two treatments for one gesture was the thing being fixed.
 *
 * ## When to use which
 *
 * `Tabs` when the control owns the panel below it — it manages the panel, and this does not.
 * `Segmented` for everything else: an optional overlay you can turn off, a theme setting, a
 * filter, an export format. Those are option pickers rather than tab strips, and
 * `ToggleGroup` is the right primitive for them; only its shape needed saying.
 */

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

/**
 * `TabsList`'s own treatment, plus a border. The fill alone measures 1.09:1 against a light
 * card, so without an edge the group has no boundary at all — and a boundary is what makes
 * six words read as one control instead of six words.
 */
const TRACK = 'bg-muted text-muted-foreground w-fit items-center rounded-lg border p-[3px]';

/**
 * The pill — and this is now upstream `TabsTrigger`'s active treatment rather than something
 * invented here. The change is the point, so it is worth being exact about what moved.
 *
 * Under `examdedo` this file carried a LOCAL invention — `bg-accent` plus
 * `data-[state=on]:border-input` — and a comment saying `shadow-sm` was omitted deliberately
 * because that theme set `--shadow-opacity: 0`, so the class "would look like it does
 * something and do nothing". THAT COMMENT WAS WRONG. Tailwind v4's `shadow-sm` inlines its
 * own `0 1px 3px 0 #0000001a` and never reads `--shadow-sm`, so the class worked the whole
 * time and upstream's mechanism was available all along. The invention was never needed.
 * Checked in the compiled stylesheet, not reasoned about; see the shadow note in `theme.css`.
 *
 * So the pill goes back to upstream's arrangement, transposed to `data-[state=on]`, and the
 * drift against Tabs is zero. Re-measured against stock shadcn, and the first column is the
 * whole story:
 *
 *              pill fill vs track   pill border vs track   ink on pill   resting ink on track
 *   light            1.00                    -                19.80             4.35
 *   dark             1.00                translucent          17.18             5.86
 *
 * `--accent`, `--muted` and `--secondary` are THE SAME VALUE in stock — #f5f5f5 in light,
 * #262626 in dark. So the selected pill's fill and the track it sits in are the same colour,
 * exactly, in both modes. There is no fill signal at all to measure.
 *
 * What carries the state is therefore `shadow-sm` in light — Tailwind's own black-at-10%,
 * since stock declares no `--shadow-*` — and in dark `border-input`, which stock defines as
 * `oklch(1 0 0 / 15%)`, translucent white rather than a colour, so it composites to a visible
 * edge over the track without having a contrast figure of its own.
 *
 * That is upstream `TabsTrigger`'s arrangement rendered in upstream's own palette, so it is as
 * intended as it will get. It does not clear WCAG 1.4.11's 3:1 for a control boundary, and no
 * palette this app has worn did: the four themes measured here ran 1.05, 1.09, 1.21 and 1.33.
 * An earlier pass "fixed" it by giving `--input` a value of its own; that was reverted twice,
 * because it is a theme override nobody asked for. The instrument is `--input` in `theme.css`,
 * changed deliberately and once, not this component.
 *
 * The two `dark:` overrides are copied from `TabsTrigger` verbatim rather than rewritten with
 * semantic tokens. Normally that would be the wrong instinct; here matching Tabs exactly IS
 * the requirement, and diverging to be tidier would put two treatments back on one gesture.
 *
 * `border-transparent` rather than `border-0` on the resting state: the border box has to
 * exist, or the selected state's `border-input` would have nothing to colour and every item
 * would shift a pixel as you click along the row.
 */
const PILL = [
    'rounded-md border border-transparent transition-all',
    'data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm',
    'dark:data-[state=on]:border-input dark:data-[state=on]:bg-input/30',
    'data-[state=off]:bg-transparent data-[state=off]:text-muted-foreground',
    'hover:text-foreground',
].join(' ');

/**
 * `spacing={1}` is load-bearing, and finding out why cost a round trip.
 *
 * At the default `spacing=0` the component applies
 * `data-[spacing=0]:rounded-none data-[spacing=0]:first:rounded-l-md
 * data-[spacing=0]:last:rounded-r-md` to each item — the joined-strip shape. A plain
 * `rounded-md` in `className` does NOT override it: `twMerge` groups by variant, so a
 * variant-prefixed `data-[spacing=0]:rounded-none` and an unprefixed `rounded-md` are two
 * different groups, both survive, and the prefixed one wins on specificity. Measured after
 * the first attempt: the items still reported `20.4px 0 0 20.4px` and `0px`.
 *
 * Any non-zero spacing switches those rules off and gives each item its own radius, which is
 * the shape wanted — so this uses the component's own prop rather than fighting its classes.
 */
export function Segmented({ className, ...props }: React.ComponentProps<typeof ToggleGroup>) {
    return <ToggleGroup spacing={1} className={cn(TRACK, className)} {...props} />;
}

export function SegmentedItem({
    className,
    ...props
}: React.ComponentProps<typeof ToggleGroupItem>) {
    return <ToggleGroupItem className={cn(PILL, className)} {...props} />;
}
