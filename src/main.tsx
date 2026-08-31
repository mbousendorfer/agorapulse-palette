import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';

/*
   ONE typeface, and it is the one `shadcn init` vendors: Geist.

   That is the whole point of this file now. The previous three themes each brought a pair —
   Manrope + IBM Plex Mono, Google Sans Flex + Geist Mono, Inter + JetBrains Mono — and each
   pair was a theme customisation. Stock shadcn declares `--font-sans` only.

   THERE IS NO MONO IMPORT, and that is deliberate rather than an omission. Stock leaves
   `--font-mono` unset, so Tailwind's own stack applies — `ui-monospace, SFMono-Regular, Menlo,
   Monaco, Consolas, …` — which resolves to a real monospace on every platform this runs on.
   The palette wall prints 66 hex read-outs in a grid and needs equal-width digits; a monospace
   gives that by construction, so vendoring a second face would buy nothing and would be a
   customisation. Checked on screen rather than assumed.

   OFL-1.1, served from the bundle rather than a CDN because this project does not reach
   third-party hosts (the sync script rewrites remote image URLs for the same reason). Variable
   build, so `wght.css` covers every weight in one axis; upright only, since nothing here is
   italic.
*/
import '@fontsource-variable/geist/wght.css';

/* One stylesheet entry point. `theme.css` imports `app.css` into the components layer,
   which is what keeps `app.css` from outranking shadcn's utilities — importing it here
   as a second entry would put it back outside the layers. */
import './ui/theme.css';

const el = document.getElementById('app');
if (!el) throw new Error('#app is missing from index.html');

createRoot(el).render(
    <StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </StrictMode>,
);
