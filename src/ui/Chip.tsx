/**
 * A small verdict, on a shadcn `Badge`.
 *
 * `chip ok` / `chip warn` / `chip bad` appeared 37 times across the app, each one a
 * hand-written class string. shadcn's `Badge` has no notion of "this is good news" —
 * its variants are `default` / `secondary` / `destructive` / `outline` — so mapping the
 * app's three verdicts onto it in one place is what keeps `ok` the same green in the
 * audit table, the burndown and the picker.
 *
 * The tones are deliberately not the shadcn variants:
 *
 *   ok      the thing holds, or the swap changes nothing on screen
 *   warn    it holds but has no slack, or the swap shifts a colour
 *   bad     it is broken
 *   plain   a count or a label with no verdict attached — most chips, in fact
 *
 * `plain` exists because a chip that carries no judgement was the commonest case and
 * kept being written as `chip` with no tone. Naming it stops the next reader wondering
 * whether the tone was forgotten.
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type ChipTone = 'ok' | 'warn' | 'bad' | 'plain';

/**
 * The four tones — and stock shadcn gives exactly one colour to spend on them.
 *
 * `--destructive` is the only chromatic token in the stock palette, so `bad` gets the red and
 * the other three separate by ink and fill instead of by hue. That is the house rule for this
 * codebase anyway (hierarchise by weight and size, never by dropping text into a lighter
 * grey), and it is what shadcn's own documentation does.
 *
 *   plain   `text-muted-foreground`   a count or a label with no verdict, which is most chips
 *   ok      `text-foreground`         it holds, or the swap changes nothing on screen
 *   warn    a FILLED `bg-secondary`   it holds but has no slack, or the swap shifts a colour
 *   bad     `text-destructive`        it is broken
 *
 * `warn` is the only one that changes shape rather than colour: every Chip is
 * `variant="outline"`, so filling one is the strongest move available without a hue, and "no
 * slack" is the verdict that most needs to be noticed. Under the three themes before this the
 * same distinction was carried by an amber, via an added `--warn` token — which is exactly the
 * kind of addition that made the app stop looking like the theme it claimed to use.
 */
const TONE: Record<ChipTone, string> = {
    ok: 'text-foreground',
    warn: 'bg-secondary text-secondary-foreground border-transparent font-semibold',
    bad: 'border-destructive/50 text-destructive',
    plain: 'text-muted-foreground',
};

export function Chip({
    tone = 'plain',
    className,
    ...props
}: React.ComponentProps<typeof Badge> & { tone?: ChipTone }) {
    return (
        <Badge
            variant="outline"
            className={cn(
                'h-[18px] shrink-0 px-1.5 text-[10px] font-medium tabular-nums',
                TONE[tone],
                className,
            )}
            {...props}
        />
    );
}
