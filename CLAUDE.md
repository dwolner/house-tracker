# House Tracker

Real estate analysis system — Main Line PA, San Diego CA, St. Louis MO.

## Architecture Quick Reference

- Full architecture in `docs/architecture.md`
- `RedfinListing` = only Redfin CSV fields. `ScoringInput extends RedfinListing` adds enrichment fields. `RelistingContext` is passed as a separate 4th arg to `scoreWithBreakdown` — never on any listing type.
- All web app icons use inline Lucide SVG via `ico(name, size)` in `app.js`. Use `icoAttr()` when embedding in HTML attribute values. Email uses Unicode characters (SVG unsupported in email clients).
- SD and STL trend charts group by ZIP (not city) — all SD listings share `city = "san diego"`.
- **Never scrape Redfin HTML listing pages in a production code path.** Their WAF blocks them from
  most datacenter IPs (405 + captcha) while leaving `/stingray/api/*` open. AI briefs use
  `listing_remarks` captured from the JSON API at poll time; HTML is a fallback only.
- **The `gis` JSON endpoint silently ignores `status`, `num_beds`, and `max_price`** — it returns 200
  and the wrong rows. Filter client-side. STL is the only JSON locale and therefore cannot detect
  sold/pending listings at all. See "Redfin APIs Used" in `docs/architecture.md`.

## Scoring Calibration Sessions

When running a calibration session or analyzing listing feedback, always check `docs/listing-notes.md` first. It contains ad-hoc observations about specific listings that capture factors the scoring model can't see (noise, neighborhood trajectory, specific quirks, etc.). Use these notes to inform weight adjustment suggestions.
