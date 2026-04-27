/**
 * Live 30-year fixed mortgage rate from Freddie Mac PMMS via FRED public CSV.
 *
 * Source: https://fred.stlouisfed.org/series/MORTGAGE30US (Freddie Mac, weekly Thursday)
 * No API key required — FRED provides a public CSV endpoint.
 *
 * Cached in the `settings` table with a 7-day TTL so the server doesn't
 * re-fetch on every restart. Falls back to 6.9% if the fetch fails.
 */

import fetch from 'node-fetch';
import { getSetting, setSetting } from '../db/index.js';

const FRED_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US';
const CACHE_KEY = 'mortgage_rate_30yr';
const CACHE_TTL_DAYS = 7;
const FALLBACK_RATE = 0.069; // updated April 2026

export async function getCurrentMortgageRate(): Promise<number> {
  // Check cache
  const cached = getSetting(CACHE_KEY);
  if (cached) {
    const { rate, fetchedAt } = JSON.parse(cached) as { rate: number; fetchedAt: string };
    const ageMs = Date.now() - new Date(fetchedAt).getTime();
    if (ageMs < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
      return rate;
    }
  }

  try {
    const res = await fetch(FRED_CSV, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);

    const text = await res.text();
    // CSV format: DATE,MORTGAGE30US\n2024-01-04,6.62\n...
    const lines = text.trim().split('\n');
    // Find last non-empty, non-"." value (FRED uses "." for missing data)
    let rate: number | null = null;
    for (let i = lines.length - 1; i >= 1; i--) {
      const [, val] = lines[i].split(',');
      if (val && val.trim() !== '.') {
        rate = parseFloat(val.trim()) / 100; // FRED publishes as e.g. "6.87"
        break;
      }
    }
    if (!rate || isNaN(rate)) throw new Error('no valid rate in FRED response');

    setSetting(CACHE_KEY, JSON.stringify({ rate, fetchedAt: new Date().toISOString() }));
    console.log(`[mortgage-rate] fetched ${(rate * 100).toFixed(2)}% from FRED`);
    return rate;
  } catch (e) {
    console.warn(`[mortgage-rate] fetch failed, using cached/fallback:`, (e as Error).message);
    // Try stale cache before fallback
    if (cached) {
      return (JSON.parse(cached) as { rate: number }).rate;
    }
    return FALLBACK_RATE;
  }
}

// Standalone runner
if (process.argv[1]?.endsWith('mortgage-rate.ts') || process.argv[1]?.endsWith('mortgage-rate.js')) {
  getCurrentMortgageRate().then(r => console.log(`Current 30yr rate: ${(r * 100).toFixed(2)}%`));
}
