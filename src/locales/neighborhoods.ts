import { LOCALES } from './index.js';
import type { LocaleConfig, NeighborhoodCondition } from './types.js';

function matches(cond: NeighborhoodCondition, lat: number | null, lng: number | null): boolean {
  const val = cond.field === 'lat' ? lat : lng;
  if (val == null) return false;
  switch (cond.op) {
    case '<':  return val < cond.value;
    case '<=': return val <= cond.value;
    case '>':  return val > cond.value;
    case '>=': return val >= cond.value;
  }
}

// Resolve a listing's display neighborhood from its ZIP (+ lat/lng for ZIPs that split
// into multiple named areas). ZIPs are unique across locales in this dataset, so this
// searches every configured locale rather than requiring a locale_id — callers (email
// digest, API routes) that only have {zip, lat, lng} on hand don't need to thread one through.
export function resolveNeighborhood(
  zip: string | null | undefined,
  lat?: number | null,
  lng?: number | null,
): string | null {
  if (!zip) return null;
  for (const locale of Object.values(LOCALES)) {
    const zn = locale.neighborhoods?.find(n => n.zip === zip);
    if (!zn) continue;
    for (const split of zn.splits ?? []) {
      if (split.when.every(c => matches(c, lat ?? null, lng ?? null))) return split.name;
    }
    return zn.name;
  }
  return null;
}

// Flattened {zip, name, color} rows for one locale's sidebar filter / map boundaries /
// chart legend — one row per ZIP's default name, plus one per split unless showInFilter: false.
export function listNeighborhoods(locale: LocaleConfig): { zip: string; name: string; color: string }[] {
  if (!locale.neighborhoods) return [];
  return locale.neighborhoods.flatMap(zn => [
    { zip: zn.zip, name: zn.name, color: zn.color },
    ...(zn.splits ?? [])
      .filter(s => s.showInFilter !== false)
      .map(s => ({ zip: zn.zip, name: s.name, color: zn.color })),
  ]);
}
