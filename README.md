# carromstats

Player achievements and stats for Maharashtra carrom, aggregated from the
[Maharashtra Carrom Association](https://maharashtracarromassociation.com/)
public website.

Unofficial. Data sourced from public MCA pages via a scheduled scraper.

## Local development

```bash
npm install
npm run dev        # Astro dev server
npm run build      # static site → dist/
```

## Data pipeline

```bash
npm run refresh    # scrape → build-players → collisions → sanity-check
```

Data lives in `data/`; the site is generated from it at build time.

## Deploy

- **Site**: `.github/workflows/deploy.yml` builds and publishes to
  GitHub Pages on every push to `main`.
- **Data refresh**: `.github/workflows/refresh.yml` (added in a later
  phase) will run the scraper on a weekly cron and open a PR with the
  data diff — merges are manual for v1. Auto-merge is deferred until
  the pipeline is proven.
