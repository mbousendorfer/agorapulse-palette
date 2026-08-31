import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, letting the last conflicting Tailwind utility win.
 *
 * Every shadcn component imports this. `clsx` flattens the conditional forms;
 * `twMerge` is what makes a `className` prop able to override a component's own
 * defaults — without it, `<Button className="px-2">` would emit two padding
 * utilities and the winner would depend on stylesheet order rather than on the
 * call site.
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
