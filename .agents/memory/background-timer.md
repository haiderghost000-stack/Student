---
name: Background timer
description: Timer behavior across hidden tabs, reloads, and page closure.
---

Use a persisted absolute end timestamp as the source of truth for active study and break timers. Recompute the remaining time on an interval and when the page regains focus or visibility; do not measure elapsed time by counting interval ticks. A closed page cannot play an alarm without separate background-notification support.

**Why:** Students expect focus and break time to keep progressing when they switch apps, and browsers throttle timers in background tabs.

**How to apply:** Preserve deadline-based state when changing timer controls or persistence. Be explicit that sound may not play after the page is closed.
