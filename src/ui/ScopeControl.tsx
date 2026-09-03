/**
 * Brand, product, or both: the one control for a colour's scope, used on the wall's row
 * header and in the Add-a-colour dialog so the two cannot phrase the choice differently.
 *
 * A multiple-select `Segmented`, because the two are not exclusive and a colour with neither is
 * a legitimate state (nothing declared yet). Two words rather than a dropdown: there are two
 * options, both always visible, and what is on and what is off is the whole information.
 */

import { Segmented, SegmentedItem } from './Segmented';

import { SCOPES, SCOPE_LABEL, normaliseScopes, type Scope } from '../engine/scope';

export function ScopeControl({
    value,
    onChange,
    subject,
    className,
}: {
    value: readonly Scope[];
    onChange: (next: Scope[]) => void;
    /** The colour's name, for the accessible label and the titles. */
    subject: string;
    className?: string;
}) {
    return (
        <Segmented
            type="multiple"
            size="sm"
            value={[...value]}
            onValueChange={(next) => onChange(normaliseScopes(next as Scope[]) ?? [])}
            aria-label={`What ${subject} is for`}
            className={className}
        >
            {SCOPES.map((scope) => (
                <SegmentedItem
                    key={scope}
                    value={scope}
                    className="h-5 px-1.5 text-[11px]"
                    title={`${subject} is ${value.includes(scope) ? '' : 'not '}a ${scope} design colour`}
                >
                    {SCOPE_LABEL[scope]}
                </SegmentedItem>
            ))}
        </Segmented>
    );
}
