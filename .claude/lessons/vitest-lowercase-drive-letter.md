---
slug: vitest-lowercase-drive-letter
layer: vault
status: local
---

# Vitest fails every file when run from a lowercase drive letter

**Rule:** Run Vitest and npm from a working directory typed with an uppercase drive letter (C:\...); from a lowercase c:\ every Vitest file fails with 'failed to find the current suite' because the setup file and the tests load two copies of vitest.

## Occurrences

### 2026-11-10 — sual-cavab

2026-11-10: after a harness 'Environment update' switched the shell's working directory to a lowercase `c:\...` path, every frontend test file failed with 'Vitest failed to find the current suite', including files I had not touched. I suspected the review agent's node_modules junction and ran `npm ci` (no effect) before noticing that the Vitest banner printed `c:/Users` instead of `C:/Users`. Running the same command from PowerShell with `C:\...` passed. Reviewer briefings now say to use an uppercase drive letter.

**Cost:** About 20 minutes and a needless reinstall of node_modules.

