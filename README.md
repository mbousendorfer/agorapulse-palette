# Agorapulse Palette

A colour editor for the Agorapulse V3 reference palette. Move an anchor and watch all
66 shades re-derive on the shared ladder; hold one shade off the ladder with a recorded
reason; add a family from a hue or a hex.

**⚠️ Private.** It vendors design tokens from the private `agorapulse/design`
repository — see [LICENSE](LICENSE) for what that does and does not cover.

## The one idea

The palette is **solved, not picked.** Five anchor hexes, a handful of parameters and
two declared exceptions produce all 66 shades. `spec/palette.baseline.json` is the
input; the shades are its outputs.

That claim is a test rather than a comment. `npm run fidelity` solves the spec and
compares the result to the palette the design system ships, within 1 LSB per channel:

```
66/66 rungs within 1 LSB  (57 byte-exact, 9 within rounding, 0 failing)
```

If that fails, either the engine broke or the design system moved — and it names the
shade that changed.

## Where it came from

Extracted from `agorapulse-color-lab`, which is two tools in one shell: this palette
editor, and a V2 → V3 migration workbench spanning 64 components with a live preview of
the real design system. The migration half is what tied that repo to a 2.6 MB snapshot
of compiled stylesheets and call-site inventories. This one keeps the engine and the
wall and leaves the rest behind.

## Getting started

```bash
npm install
npm run dev
```

|                    |                                                                      |
| ------------------ | -------------------------------------------------------------------- |
| `npm run fidelity` | solve the spec, compare to the shipped palette, print the derivation |
| `npm run verify`   | typecheck, lint, format, fidelity, dead CSS, class conflicts, tests  |
| `npm run figma`    | re-vendor `figma-variables.json` from a Figma export zip             |

The build is deployed to GitHub Pages on every push to `main`.

## What it holds against itself

Three numbers this tool refuses to write down as prose, because prose does not fail:

- **66/66** — `npm run fidelity` re-derives every shade from the spec and compares it to
  the palette the design system ships. It names the shade that moved.
- **The seven constraints** — evaluated live in the status bar, with the slack on each.
  "2 with no slack" means the next nudge in that direction breaks the palette.
- **What each anchor moves** — measured per row in "How this palette is built" by nudging
  that anchor and re-solving, not remembered. The sentence it replaced said "35, 37 and
  49"; measured, they are 33, 35 and 49, so it had already drifted.
