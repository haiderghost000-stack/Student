---
name: PDF Arabic zoom rendering
description: Keeps the Arabic PDF text layer stable while pages zoom and rerender.
---

When displaying Arabic through PDF.js TextLayer, set the Arabic fallback font in the text-content style map before constructing the layer so PDF.js measures and renders with the same font. Do not override the span font in CSS after layout. Serialize or cancel prior canvas and text-layer renders before reusing a page's canvas and DOM. For pinch zoom, scale the existing page stack as a temporary preview and commit the new PDF render scale once when the gesture ends, preserving the pinch focal point.

**Why:** A CSS-only font override changes glyph widths after PDF.js has calculated span scaling; zoom redraws can fragment or misalign text. Re-rendering on every touchmove interrupts the pinch gesture and overlaps cancelled page renders.

**How to apply:** Follow this rule when changing `PdfReader` Arabic shaping, font selection, pinch handling, or zoom rendering.
