---
title: "Weekly MCA refresh failed"
labels: [data-refresh, automated]
---

The weekly MCA data-refresh workflow failed on
[run #{{ env.GITHUB_RUN_ID }}]({{ env.GITHUB_SERVER_URL }}/{{ env.GITHUB_REPOSITORY }}/actions/runs/{{ env.GITHUB_RUN_ID }}).

Common causes:

- **MCA changed page layout** — the tournament / points / champions parsers rely on
  specific selectors. Inspect one of the raw HTMLs cached in `.cache/`.
- **Sanity check tripped a drop/jump threshold** — the previous vs. new counts
  differed by more than the allowed 5% drop / 50% jump. Read the workflow logs.
- **404 spike** — the scraper's `.cache/` layer stores `__404__` markers.
  If MCA temporarily moved a page, clear `.cache/` for that URL and re-run.

This issue was auto-created. Please close it once the underlying cause is fixed and
the next run succeeds.
