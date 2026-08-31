import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    /*
       `base` is configurable so the app can be served from a sub-path.

       Nothing here reads `import.meta.env.BASE_URL` any more — that indirection existed for
       the component preview's iframe, which built a `<base href>` so `font-face.css`'s
       relative `url()`s would resolve. There is no iframe and no vendored stylesheet in this
       tool, so a sub-path build is a plain asset-URL rewrite now.
    */
    base: process.env.VITE_BASE ?? '/',
    plugins: [react(), tailwindcss()],
    resolve: {
        // `@/…` is what the shadcn CLI writes into every component it adds.
        alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
        watch: {
            /*
               `vendor/` is not watched, and the reason survives the fork even though the sync
               script does not.

               `src/model/load.ts` imports the token JSON through
               `import.meta.glob(..., { eager: true })`, so Vite inlines it at build time. A
               watcher firing on those files reloads the page, and re-vendoring the snapshot
               rewrites all of them at once. The consequence to remember while working here:
               ADDING OR REMOVING a vendored token file needs a dev-server restart, because the
               glob is resolved once.
            */
            ignored: ['**/vendor/**'],
        },
    },
    build: {
        target: 'es2022',
        sourcemap: true,
    },
});
