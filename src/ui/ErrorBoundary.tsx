/**
 * The last line of defence, because the session is now worth something.
 *
 * A throw anywhere under `<App />` used to unmount the tree and leave a blank
 * white page with the message in the console — indistinguishable from a dead dev
 * server. That was survivable while the app forgot everything on reload anyway;
 * it is not now that a session holds a migration plan, because the natural
 * reaction to a blank page is to close the tab.
 *
 * So it says what broke, and it says the work is still saved — then offers the
 * reload, which is genuinely the right move since the state comes back with it.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

interface State {
    error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
    override state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    override componentDidCatch(error: Error, info: ErrorInfo) {
        // Still log it: the message on screen is for deciding what to do, the
        // console is for finding out why.
        console.error('Color Lab crashed', error, info.componentStack);
    }

    override render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        return (
            <div className="crash text-sm leading-relaxed [&_h1]:text-xl" role="alert">
                <h1>Color Lab hit an error</h1>
                <p>
                    Your session is saved. Reloading brings back the palette, the repointed tokens
                    and the migration plan — it does not start over.
                </p>
                <pre className="code bg-background text-muted-foreground rounded-md border font-mono text-xs leading-relaxed">
                    {error.message}
                </pre>
                <p className="text-muted-foreground">
                    If it happens again on the same screen, the full stack is in the browser
                    console.
                </p>
                <div className="crash-actions">
                    <Button
                        variant="default"
                        size="sm"
                        className="h-8 px-3 text-xs"
                        onClick={() => location.reload()}
                    >
                        Reload
                    </Button>
                    {/* The escape hatch of last resort: if the saved session is
                        itself what crashes on boot, reloading forever is the trap.
                        Named for what it costs, not for what it fixes. */}
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs"
                        onClick={() => {
                            localStorage.removeItem('agorapulse-color-lab.session');
                            location.reload();
                        }}
                    >
                        Discard the saved session and reload
                    </Button>
                </div>
            </div>
        );
    }
}
