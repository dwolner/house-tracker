# House Tracker

Real estate analysis system — Main Line PA, San Diego CA, St. Louis MO.

## Architecture Quick Reference

- Full architecture in `docs/architecture.md`
- `RedfinListing` = only Redfin CSV fields. `ScoringInput extends RedfinListing` adds enrichment fields. `RelistingContext` is passed as a separate 4th arg to `scoreWithBreakdown` — never on any listing type.
- All web app icons use inline Lucide SVG via `ico(name, size)` in `app.js`. Use `icoAttr()` when embedding in HTML attribute values. Email uses Unicode characters (SVG unsupported in email clients).
- SD and STL trend charts group by ZIP (not city) — all SD listings share `city = "san diego"`.

## Scoring Calibration Sessions

When running a calibration session or analyzing listing feedback, always check `docs/listing-notes.md` first. It contains ad-hoc observations about specific listings that capture factors the scoring model can't see (noise, neighborhood trajectory, specific quirks, etc.). Use these notes to inform weight adjustment suggestions.
