---
name: Student data storage
description: Product decision about where a student's tasks, notes, PDFs, and study progress are kept.
---

Keep the study companion's personal content in browser storage unless the user explicitly chooses account-based syncing. Treat cross-device sync as a separate feature, not an implicit extension.

**Why:** The initial app was scoped to provide a usable study space without requiring accounts or cloud storage; its local-only data also avoids uploading personal notes and documents by default.

**How to apply:** Preserve local storage behavior for tasks, notes, preferences, and progress, and browser file storage for PDFs. If sync is requested, explain the account and document-storage implications and implement it as an explicit opt-in path.
