---
name: PDF viewing flow
description: Product choice for opening stored PDFs from the student's library.
---

Open a student's stored PDF in a new browser tab so the browser or phone can use its native PDF viewer. Open the blank tab synchronously from the user's click before awaiting the IndexedDB read, then navigate it to a Blob URL for the stored file. Keep that URL valid while the tab is open and revoke it when the tab closes. PDF.js remains in use only to generate the first-page library cover. Keep PDF bytes in browser storage; do not upload them.

**Why:** The user asked to remove the in-page PDF reader and open files in a new tab or the phone's default PDF handler. This avoids custom viewer behavior while preserving the existing local-only document storage.

**How to apply:** Do not reintroduce an in-page PDF reader or pan/zoom library unless the user explicitly requests it. When changing the library open flow, preserve the synchronous popup gesture, local IndexedDB storage, and Blob URL lifetime.
