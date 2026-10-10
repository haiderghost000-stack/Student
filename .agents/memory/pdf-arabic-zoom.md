---
name: PDF Arabic zoom rendering
description: Keeps the Arabic PDF text layer stable while pages zoom and rerender.
---

When displaying Arabic through PDF.js TextLayer, set the Arabic fallback font in the text-content style map before constructing the layer so PDF.js measures and renders with the same font. Do not override the span font in CSS after layout. Serialize or cancel prior canvas and text-layer renders before reusing a page's canvas and DOM.

**Why:** A CSS-only font override changes glyph widths after PDF.js has calculated span scaling; zoom redraws can fragment or misalign text. Overlapping cancelled renders can also reuse the same page canvas.

**How to apply:** Follow this rule when changing `PdfReader` Arabic shaping, font selection, or zoom rendering.
