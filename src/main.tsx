import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';

/*
   TWO typefaces, because this app has two voices.

   ## What changed, and why the previous argument does not survive it

   This file used to import Geist alone and argue the case for it at length: `shadcn init`
   vendors Geist, stock shadcn declares `--font-sans` only, and "THERE IS NO MONO IMPORT, and
   that is deliberate rather than an omission" — because leaving `--font-mono` unset lets
   Tailwind's own `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, …` apply, which is a
   real monospace everywhere this runs.

   Every sentence of that is true and the conclusion is still wrong, because it is a
   CONFORMANCE argument standing in for a design one. Two things it did not price:

     · `ui-monospace` is a different typeface on every platform. The wall prints 66 hex
       read-outs in aligned columns and the inspector prints L/C/h to four decimals — that
       grid IS the product, and it was rendering in SF Mono on a Mac, Consolas on Windows and
       DejaVu Sans Mono on Linux. Three different products. "A monospace gives equal-width
       digits by construction" answers legibility and says nothing about whether the thing
       somebody is shown is the thing that was designed.
     · Geist is a fine face and a generic one. This tool is a measuring instrument; its chrome
       carries no colour at all, by construction, because every surface is a ground somebody is
       judging a hue against. With colour unavailable as a design material, the typeface is
       most of what is left.

   So: **Archivo** for the interface and **Azeret Mono** for data. Archivo is a grotesque with
   tight apertures and real tabular figures; Azeret Mono (Displaay) has the tall x-height and
   blunt terminals of technical documentation and is far less worn than JetBrains or Plex. The
   pair reads as a bench instrument rather than as a dashboard, which is the point.

   `--font-mono` is now DECLARED in `theme.css` rather than left to Tailwind. That is a theme
   customisation and it is the sixth deviation; it is recorded there with the other five.

   OFL-1.1 both, served from the bundle rather than a CDN because this project does not reach
   third-party hosts (the sync script rewrites remote image URLs for the same reason). Variable
   builds, so `wght.css` covers every weight in one axis each; upright only, since nothing here
   is italic.
*/
import '@fontsource-variable/archivo/wght.css';
import '@fontsource-variable/azeret-mono/wght.css';

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
