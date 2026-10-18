---
name: Dependency firewall recovery
description: Resolving post-merge installs blocked by the internal package registry.
---

When a frozen pnpm install gets a 403 for an outdated transitive package, identify its direct parent and update that parent to a current compatible release before changing the setup script. Keep the full workspace install and configured database step intact instead of skipping packages.

**Why:** The internal package firewall rejected a stale locked transitive tarball; updating its parent dependency restored the complete post-merge setup.

**How to apply:** Use this approach for package-firewall 403 errors during dependency installation, then rerun the configured post-merge setup to confirm the entire script and workflow reconciliation succeed.
