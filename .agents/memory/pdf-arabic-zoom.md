---
name: PDF viewing flow
description: Product choice for opening stored PDFs from the student's library.
---

PDF reading must happen inside the app's own React-rendered viewer, not a browser-native PDF iframe or external tab. Keep stored PDF files local in IndexedDB and use a maintained gesture library for pinch zoom and panning; do not write custom focal-point calculations.

**Why:** The user explicitly rejected browser-embedded PDF viewing and asked for app-owned reading with reliable mobile zoom after prior anchor-point problems.

**How to apply:** Preserve local IndexedDB storage, vertical page flow, and the app's own controls. Let the viewer library manage pinch anchoring and zoomed-page panning; avoid browser iframes and hand-rolled zoom transforms.
