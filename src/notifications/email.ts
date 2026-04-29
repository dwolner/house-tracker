import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST ?? 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? '587', 10);
const SMTP_USER = process.env.SMTP_USER ?? '';
const SMTP_PASS = process.env.SMTP_PASS ?? '';
const NOTIFY_TO = process.env.NOTIFY_TO ?? '';
export const NOTIFY_SCORE_THRESHOLD = parseFloat(process.env.NOTIFY_SCORE_THRESHOLD ?? '70');

export interface NotifyListing {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
  price_at_first_seen: number | null;
  beds: number;
  baths: number;
  sqft: number | null;
  lot_sqft: number | null;
  days_on_market: number | null;
  first_seen_at: string | null;
  score: number;
  score_breakdown: string | null;
  school_district: string | null;
  property_type: string | null;
  walk_score: number | null;
  url: string | null;
}

type Palette = {
  bg: string; surface: string; border: string; text: string; muted: string;
  faint: string; accent: string; green: string; yellow: string; red: string; statBg: string;
};

const DARK: Palette = {
  bg:      '#0b0d12',
  surface: '#0f1219',
  border:  '#1e2636',
  text:    '#e2ddd5',
  muted:   '#7a8195',
  faint:   '#303a50',
  accent:  '#c4913a',
  green:   '#4a9e72',
  yellow:  '#c4913a',
  red:     '#c05a47',
  statBg:  '#161c26',
};

const LIGHT: Palette = {
  bg:      '#f0ede6',
  surface: '#ffffff',
  border:  '#ddd8ce',
  text:    '#1a1814',
  muted:   '#6b6860',
  faint:   '#e8e4dc',
  accent:  '#a07020',
  green:   '#2a7a50',
  yellow:  '#a07020',
  red:     '#a03828',
  statBg:  '#f5f2eb',
};

// Keep D as an alias for dark to avoid touching non-palette code paths
const D = DARK;

function isConfigured(): boolean {
  return Boolean(SMTP_USER && SMTP_PASS && NOTIFY_TO);
}

function photoUrl(id: string): string | null {
  if (!id) return null;
  // CDN region codes differ by MLS feed
  let region: number;
  if (id.startsWith('PAMC'))                    region = 235; // PA TREND MLS
  else if (id.startsWith('NDP') || id.startsWith('PTP')) region = 45;  // SD CRMLS
  else if (/^\d{9}$/.test(id))                  region = 48;  // SD SDMLS (Sandicor)
  else return null;
  return `https://ssl.cdn-redfin.com/photo/${region}/mbpaddedwide/${id.slice(-3)}/genMid.${id}_0.jpg`;
}

function fmt(n: number | null | undefined): string {
  return n != null ? n.toLocaleString() : '—';
}

function fmtAcres(sqft: number | null): string {
  if (sqft == null) return '—';
  const ac = sqft / 43560;
  return ac < 0.1 ? sqft.toLocaleString() + ' sqft' : ac.toFixed(2) + ' ac';
}

function scoreColors(score: number, P: Palette): { bg: string; color: string } {
  if (score >= 80) return { bg: 'rgba(74,158,114,0.12)', color: P.green };
  if (score >= 60) return { bg: 'rgba(196,145,58,0.12)', color: P.yellow };
  return { bg: 'rgba(192,90,71,0.12)', color: P.red };
}

function domLabel(dom: number | null, P: Palette): string {
  if (dom == null) return '';
  if (dom > 120) return `<span style="color:${P.red};font-weight:600">(⚠ ${dom} d)</span>`;
  if (dom > 30)  return `<span style="color:${P.yellow};font-weight:600">(~${dom} d)</span>`;
  return `<span style="color:${P.muted}">(${dom} d)</span>`;
}


function priceChangeHtml(l: NotifyListing, P: Palette): string {
  if (!l.price_at_first_seen || l.price_at_first_seen === l.price) return '';
  const diff = l.price - l.price_at_first_seen;
  const sign = diff < 0 ? '▼' : '▲';
  const color = diff < 0 ? P.green : P.red;
  return `<span style="font-size:16px;color:${color};margin-left:6px"><span style="font-size:10px">${sign}</span> $${Math.abs(diff).toLocaleString()}</span>`;
}


const FACTOR_LABELS: Record<string, string> = {
  propertyType:      'Type',
  schoolDistrict:    'School',
  walkability:       'Walk',
  price:             'Price',
  sqft:              'Sqft',
  lot:               'Lot',
  transit:           'Transit',
  beds:              'Beds',
  pricePerSqft:      '$/sqft',
  neighborhoodBonus: 'Local+',
  zipBonus:          'Zip+',
  domPenalty:        'DOM−',
  investmentScore:   'Invest',
  // legacy keys from old flat breakdown format
  amtrak:            'Transit',
  narberthBonus:     'Local+',
};

// Convert old flat { total, amtrak: 6, ... } format to new { total, factors: { transit: { pts, max } } }
const OLD_MAXES: Record<string, number> = {
  propertyType: 20, schoolDistrict: 20, walkability: 12, price: 12,
  sqft: 8, lot: 12, amtrak: 8, beds: 4, pricePerSqft: 4, narberthBonus: 6, domPenalty: 10,
};
const OLD_KEY_MAP: Record<string, string> = { amtrak: 'transit', narberthBonus: 'neighborhoodBonus' };

function parseBreakdown(json: string | null): { total: number; factors: Record<string, { pts: number; max: number }> } | null {
  if (!json) return null;
  try {
    const bd = JSON.parse(json);
    if (bd.factors) return bd;
    const factors: Record<string, { pts: number; max: number }> = {};
    for (const [key, max] of Object.entries(OLD_MAXES)) {
      if (bd[key] != null) factors[OLD_KEY_MAP[key] ?? key] = { pts: bd[key] as number, max };
    }
    return { total: bd.total, factors };
  } catch { return null; }
}

function chipColor(key: string, pct: number, P: Palette): { bg: string; color: string } {
  if (pct === 0) return { bg: P.statBg, color: P.muted };
  if (key === 'domPenalty')        return { bg: P.red,   color: '#fff' };
  if (key === 'neighborhoodBonus') return { bg: P.green, color: '#fff' };
  if (pct >= 0.7) return { bg: P.green,  color: '#fff' };
  if (pct >= 0.4) return { bg: P.yellow, color: '#fff' };
  return { bg: P.red, color: '#fff' };
}

function scoreChipsHtml(l: NotifyListing, P: Palette): string {
  const bd = parseBreakdown(l.score_breakdown);
  if (!bd) return '';

  const chips = Object.entries(bd.factors).filter(([key, { pts }]) => !(key === 'domPenalty' && pts === 0)).map(([key, { pts, max }]) => {
    const pct = max > 0 ? pts / max : 0;
    const { bg, color } = chipColor(key, pct, P);
    const label = FACTOR_LABELS[key] ?? key;
    const display = String(Math.round(pct * 100));

    return `<td style="padding:0 2px;text-align:center;vertical-align:top">
      <div style="background:${bg};color:${color};border-radius:3px;height:20px;line-height:20px;font-size:9px;font-weight:700;text-align:center;white-space:nowrap;padding:0 2px">${display}</div>
      <div style="font-size:8px;color:${P.muted};margin-top:3px;white-space:nowrap;text-align:center">${label}</div>
    </td>`;
  }).join('');

  return `
    <div style="margin-top:12px">
      <div style="font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:${P.muted};margin-bottom:5px">Score Breakdown</div>
      <table style="border-collapse:collapse;width:100%"><tr>${chips}</tr></table>
    </div>`;
}

function buildCard(l: NotifyListing, P: Palette, badge = ''): string {
  const img = photoUrl(l.id);
  const { bg: scoreBg, color: scoreColor } = scoreColors(l.score, P);
  const typeLabel = l.property_type
    ? l.property_type.replace(/single family residential/i, 'SFD').replace(/single family/i, 'SFD')
    : '?';
  const ppsf = l.sqft ? `$${Math.round(l.price / l.sqft)}` : '—';
  const city = l.city ?? '';
  const state = l.state ?? '';
  const zip = l.zip ?? '';

  return `
  <!-- Badge + type pill row above card -->
  <table style="width:100%;max-width:520px;margin:0 auto 6px;border-collapse:collapse"><tr>
    <td>${badge}</td>
    <td style="text-align:right;white-space:nowrap"><span style="font-size:10px;background:${P.statBg};border:1px solid ${P.border};border-radius:20px;padding:3px 10px;color:${P.muted};font-weight:500;letter-spacing:.03em">${typeLabel}</span></td>
  </tr></table>

  <table style="width:100%;max-width:520px;margin:0 auto 24px;border-collapse:collapse;border:1px solid ${P.border};border-radius:10px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:${P.surface}">
    ${img ? `<tr><td style="padding:0"><img src="${img}" width="520" style="display:block;width:100%;height:200px;object-fit:cover" alt="${l.address}"></td></tr>` : ''}
    <tr>
      <td style="padding:16px">

        <!-- Header: price + score badge aligned in same row -->
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="vertical-align:middle">
              <div style="font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;line-height:1.1;color:${P.text}">$${fmt(l.price)}${priceChangeHtml(l, P)}</div>
              <div style="font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-weight:400;font-size:17px;line-height:1.25;color:${P.text};margin-top:6px">${l.address}</div>
              <div style="font-size:11px;color:${P.muted};margin-top:3px">${city}${city && (state || zip) ? ', ' : ''}${state} ${zip}</div>
              ${l.school_district ? `<div style="font-size:10px;color:${P.accent};margin-top:4px;font-weight:500;letter-spacing:.02em">${l.school_district}</div>` : ''}
            </td>
            <td style="text-align:right;vertical-align:top;padding-left:16px;white-space:nowrap">
              <div style="display:inline-block;background:${scoreBg};border:1px solid ${scoreColor};color:${scoreColor};border-radius:50%;width:52px;height:52px;line-height:50px;text-align:center;font-size:18px;font-weight:700;font-family:'JetBrains Mono','Courier New',monospace">${Math.round(l.score)}</div>
              ${l.days_on_market != null ? `<div style="font-size:11px;color:${P.muted};margin-top:5px;text-align:right">${domLabel(l.days_on_market, P)}</div>` : ''}
            </td>
          </tr>
        </table>

        <!-- Stats row -->
        <table style="width:100%;border-collapse:collapse;margin-top:12px">
          <tr>
            <td style="width:25%;padding:7px 8px;background:${P.statBg};border-radius:5px">
              <div style="font-family:'Courier New',monospace;font-size:12px;font-weight:700;color:${P.text}">${l.beds} | ${l.baths}</div>
              <div style="font-size:9px;color:${P.muted};margin-top:2px;text-transform:uppercase;letter-spacing:.05em">Bed | Bth</div>
            </td>
            <td style="width:5px"></td>
            <td style="width:25%;padding:7px 8px;background:${P.statBg};border-radius:5px">
              <div style="font-family:'Courier New',monospace;font-size:12px;font-weight:700;color:${P.text}">${l.sqft ? fmt(l.sqft) : '—'}</div>
              <div style="font-size:9px;color:${P.muted};margin-top:2px;text-transform:uppercase;letter-spacing:.05em">Sq Ft</div>
            </td>
            <td style="width:5px"></td>
            <td style="width:25%;padding:7px 8px;background:${P.statBg};border-radius:5px">
              <div style="font-family:'Courier New',monospace;font-size:12px;font-weight:700;color:${P.text}">${fmtAcres(l.lot_sqft)}</div>
              <div style="font-size:9px;color:${P.muted};margin-top:2px;text-transform:uppercase;letter-spacing:.05em">Lot</div>
            </td>
            <td style="width:5px"></td>
            <td style="width:25%;padding:7px 8px;background:${P.statBg};border-radius:5px">
              <div style="font-family:'Courier New',monospace;font-size:12px;font-weight:700;color:${P.text}">${ppsf}</div>
              <div style="font-size:9px;color:${P.muted};margin-top:2px;text-transform:uppercase;letter-spacing:.05em">$/Sq Ft</div>
            </td>
          </tr>
        </table>

        <!-- Score chips -->
        ${scoreChipsHtml(l, P)}

        <!-- Footer: CTA -->
        <div style="margin-top:14px">
          ${l.url ? `<a href="${l.url}" style="display:block;width:100%;background:${P.accent};color:#fff;text-decoration:none;border-radius:5px;padding:8px 0;font-size:12px;font-weight:600;letter-spacing:.03em;text-align:center;box-sizing:border-box">View on Redfin →</a>` : ''}
        </div>

      </td>
    </tr>
  </table>`;
}

type ChangeWithListing = import('../db/index.js').ChangeWithListing;

function changeBadgeHtml(c: ChangeWithListing, P: Palette): string {
  if (c.change_type === 'price_drop') {
    const old = parseInt(c.old_value ?? '0');
    const diff = old - c.price;
    return `<div style="margin-bottom:8px">
      <span style="background:rgba(74,158,114,0.12);color:${P.green};border:1px solid rgba(74,158,114,0.3);padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">▼ Price Drop</span>
      <span style="font-size:12px;color:${P.muted};margin-left:8px">$${old.toLocaleString()} → <strong style="color:${P.text}">$${c.price.toLocaleString()}</strong> <span style="color:${P.green}">−$${diff.toLocaleString()}</span></span>
    </div>`;
  }
  if (c.change_type === 'price_increase') {
    const old = parseInt(c.old_value ?? '0');
    const diff = c.price - old;
    return `<div style="margin-bottom:8px">
      <span style="background:rgba(192,90,71,0.12);color:${P.red};border:1px solid rgba(192,90,71,0.3);padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">▲ Price Increase</span>
      <span style="font-size:12px;color:${P.muted};margin-left:8px">$${old.toLocaleString()} → <strong style="color:${P.text}">$${c.price.toLocaleString()}</strong> <span style="color:${P.red}">+$${diff.toLocaleString()}</span></span>
    </div>`;
  }
  if (c.change_type === 'now_active') {
    return `<div style="margin-bottom:8px">
      <span style="background:rgba(196,145,58,0.12);color:${P.accent};border:1px solid rgba(196,145,58,0.3);padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">⚡ Now Active</span>
      <span style="font-size:12px;color:${P.muted};margin-left:8px">Previously coming soon</span>
    </div>`;
  }
  return '';
}

function buildDigestHtml(newListings: NotifyListing[], changes: ChangeWithListing[], P: Palette): string {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const total = newListings.length + changes.length;

  const newBadge = `<span style="background:rgba(74,158,114,0.12);color:${P.green};border:1px solid rgba(74,158,114,0.3);padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">★ New Listing</span>`;

  const newCards = newListings.map(l => buildCard(l, P, newBadge)).join('');

  const changeCards = changes.map(c => buildCard(c, P, changeBadgeHtml(c, P))).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet">
  <style>
    .price-text { font-family: 'Cormorant Garamond', Georgia, serif !important; }
    .ui-text    { font-family: 'DM Sans', system-ui, sans-serif !important; }
    .data-text  { font-family: 'JetBrains Mono', 'Courier New', monospace !important; }
  </style>
</head>
<body style="margin:0;padding:0;background:${P.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" bgcolor="${P.bg}">
  <table style="width:100%;border-collapse:collapse" bgcolor="${P.bg}"><tr><td style="padding:24px 16px" bgcolor="${P.bg}">
    <table style="width:100%;max-width:520px;margin:0 auto 24px;border-collapse:collapse">
      <tr><td style="background:${P.surface};border:1px solid ${P.border};border-radius:10px;padding:20px 24px">
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:${P.text}">HOUSE <span style="color:${P.accent}">TRACKER</span></div>
        <div style="font-family:'Courier New',monospace;color:${P.muted};font-size:12px;margin-top:6px">${total} update${total !== 1 ? 's' : ''} · score ≥ ${NOTIFY_SCORE_THRESHOLD} · ${date}</div>
      </td></tr>
    </table>
    ${newCards}${changeCards}
    <table style="width:100%;max-width:520px;margin:0 auto;border-collapse:collapse">
      <tr><td style="text-align:center;padding:8px 0"><span style="font-size:10px;color:${P.muted};letter-spacing:.04em">house-tracker</span></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export function buildPreviewHtml(newListings: NotifyListing[], changes: ChangeWithListing[], theme: 'dark' | 'light' = 'dark'): string {
  return buildDigestHtml(newListings, changes, theme === 'light' ? LIGHT : DARK);
}

export async function sendDigest(newListings: NotifyListing[], changes: ChangeWithListing[]): Promise<void> {
  if (!isConfigured()) {
    console.log('[notify] SMTP not configured — skipping email');
    return;
  }
  if (newListings.length === 0 && changes.length === 0) return;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const newCount = newListings.length;
  const priceDrop = changes.filter(c => c.change_type === 'price_drop').length;
  const priceUp   = changes.filter(c => c.change_type === 'price_increase').length;
  const nowActive = changes.filter(c => c.change_type === 'now_active').length;
  const parts = [
    newCount   && `${newCount} new`,
    priceDrop  && `${priceDrop} price drop${priceDrop > 1 ? 's' : ''}`,
    priceUp    && `${priceUp} price increase${priceUp > 1 ? 's' : ''}`,
    nowActive  && `${nowActive} now active`,
  ].filter(Boolean);

  await transporter.sendMail({
    from: `"House Tracker" <${SMTP_USER}>`,
    to: NOTIFY_TO,
    subject: `🏠 ${parts.join(' · ')}`,
    html: buildDigestHtml(newListings, changes, DARK),
  });

  console.log(`[notify] sent digest: ${parts.join(', ')}`);
}
