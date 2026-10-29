---
name: PDF viewing flow
description: Product choice for opening stored PDFs from the student's library.
---

Open a student's stored PDF inside a full-screen in-app overlay using the browser's native PDF viewer in an iframe. Keep the PDF bytes in IndexedDB and create a Blob URL only while the viewer is open; revoke it on close. Keep PDF.js for first-page library covers. Do not add custom page transforms or pinch handlers: let the browser viewer own zoom, touch anchoring, and vertical scrolling. Keep an external-open link as a fallback for browsers that cannot embed PDFs.

**Why:** The user later explicitly requested in-app reading with stable mobile pinch zoom. The native viewer avoids the anchor-position bugs caused by custom transformations while keeping PDFs local.

**How to apply:** Preserve local IndexedDB storage and Blob URL cleanup. Do not add a sandbox attribute to the PDF iframe, because it can prevent the browser's native viewer from rendering.
