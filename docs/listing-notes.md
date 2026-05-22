# Listing Notes

Ad-hoc observations about specific listings — factors the scoring model can't see.
Reference this file during calibration analysis sessions.

## Format

```
## [Address]
[Observation — what the score misses, why you reacted the way you did]
```

---

<!-- Add notes below -->

## 4982 Ensign St, San Diego CA 92117 (Clairemont Mesa / Bay Ho)
Score: 66. Good test case for the relisting detection system — purchased for $950k in Feb 2026, relisted 3 months later at $1.3M (37% flip markup), then went inactive and relisted again in May 2026 at $1.298M. System correctly links the two listing IDs via `prior_listing_id`, applies −4pt relisting penalty (price was slightly lowered), shows true DOM of ~32 days instead of the displayed 1 day, and shows both `↑ FLIP` and `↺ RELISTING` badges. The FLIP penalty (−15 pts) is the dominant downward signal here given the aggressive markup. Structurally solid (2,200 sqft, 4bd/3ba, 0.14 ac, new systems) but the flip premium and relisting pattern signal buyer resistance — strong negotiating position.

## 5996 College Ave, San Diego CA 92120 (Allied Gardens)
Score: 80. Hard pass — sits directly on College Ave, a high-traffic arterial. Road noise is a dealbreaker and driveway egress onto that road is a daily headache. Score doesn't reflect street-facing noise exposure or traffic access difficulty. Also flagged as recent flip (73% price jump in 6 months). Would rate this a 40 or below for livability.
