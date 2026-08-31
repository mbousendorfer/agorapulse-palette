/**
 * One page heading: the title, the number the page is about, and everything else one
 * click away.
 *
 * The lede used to render always. The reasoning for hiding the LONG explanation applied
 * just as well to it and this file already said so — "it sat between you and the thing you
 * came to do, on every visit, forever. You read it once; the table you read every time" —
 * so the lede now opens with the help rather than above it. Six screens, 516 characters of
 * prose, gone from the default view without losing a word of it.
 *
 * What stays on screen is the title and the one figure the page is about. That is the
 * heading doing its job: naming the page and stating its number.
 */

import { useState, type ReactNode } from 'react';
import { HelpCircle, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function PageHeading({
    title,
    tag,
    lede,
    help,
    helpLabel = 'What this page is',
}: {
    title: string;
    /** The one figure the page is about — beside the title, not buried under it. */
    tag?: ReactNode;
    lede?: ReactNode;
    help?: ReactNode;
    helpLabel?: string;
}) {
    const [open, setOpen] = useState(false);
    const hasDetail = Boolean(lede || help);

    return (
        <>
            <h1 className="page text-lg font-bold">
                {title}
                {tag && (
                    <span className="page-tag text-muted-foreground font-medium text-xs leading-none font-sans tracking-wide">
                        {tag}
                    </span>
                )}
                {hasDetail && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-foreground size-6"
                        aria-expanded={open}
                        aria-label={open ? 'Hide the detail' : helpLabel}
                        title={open ? 'Hide the detail' : helpLabel}
                        onClick={() => setOpen((v) => !v)}
                    >
                        {open ? <X /> : <HelpCircle />}
                    </Button>
                )}
            </h1>
            {hasDetail && open && (
                <Alert className="page-help-body">
                    <AlertDescription>
                        {lede}
                        {help}
                    </AlertDescription>
                </Alert>
            )}
        </>
    );
}
