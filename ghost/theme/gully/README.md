# Gully

The theme for the Gully Labs blog (blog.gullylabs.xyz), Ghost 6, on the 2026-11 Gully Labs kit (navy #0E1C38, blue #3754A0,
light blue #6F8DDF, ground #F1F3F8), Figtree, "You Think It, We Ship It."

Built on Ghost's [Source](https://github.com/TryGhost/Source) theme, v1.7.6 (MIT, Copyright (c) 2013-2026
Ghost Foundation). The Ghost card layout grid and card spacing rules come from Source; the templates,
styles and scripts are Gully Labs' own. See `LICENSE`.

Third-party parts:
- Fonts: Figtree 400-800 (the same files as gullylabs.xyz; the kit has no font) and IBM Plex Mono 400/500 (SIL Open Font
  License 1.1; licences in `assets/fonts`). Self-hosted, nothing from Google Fonts.
- `assets/brand/`: the kit's logotype, mark and badge byte for byte, and the favicons, app icons, owl WebPs and share card
  the website derives from the kit (`public/brand/kit`, `scripts/brand-kit-derive.py`), same bytes as there. `npm run
  test:blog-theme` checks all of it. Never re-drawn or re-coloured.
- Icons: lucide 1.49.0 (ISC), inlined as SVG partials; X, GitHub and Telegram marks from simple-icons (CC0).
- `assets/js/lib/reframe.min.js` (MIT, from Source) for responsive video embeds.

Build, preview, packaging and upload notes: `ghost/README.md` in the website repository.
