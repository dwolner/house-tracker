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
  score: number;
  score_breakdown: string | null;
  school_district: string | null;
  property_type: string | null;
  walk_score: number | null;
  url: string | null;
}

// Dark theme palette (matches dashboard dark mode)
const D = {
  bg:      '#0f1117',
  surface: '#1a1d27',
  border:  '#2a2d3a',
  text:    '#e8eaf0',
  muted:   '#8b92a5',
  accent:  '#4f8ef7',
  green:   '#22c55e',
  yellow:  '#eab308',
  red:     '#f87171',
  statBg:  '#13161f',
};

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

function scoreColors(score: number): { bg: string; color: string } {
  if (score >= 80) return { bg: '#14532d', color: D.green };
  if (score >= 60) return { bg: '#713f12', color: D.yellow };
  return { bg: '#7f1d1d', color: D.red };
}

function domText(dom: number | null): string {
  if (dom == null) return '';
  if (dom > 120) return `<span style="color:${D.red};font-size:11px;font-weight:600">⚠ ${dom} days on market</span>`;
  if (dom > 30)  return `<span style="color:${D.yellow};font-size:11px;font-weight:600">~${dom} days on market</span>`;
  return `<span style="color:${D.muted};font-size:11px">${dom} days on market</span>`;
}

function priceChangeHtml(l: NotifyListing): string {
  if (!l.price_at_first_seen || l.price_at_first_seen === l.price) return '';
  const diff = l.price - l.price_at_first_seen;
  const sign = diff < 0 ? '▼' : '▲';
  const color = diff < 0 ? D.green : D.red;
  return `<span style="font-size:11px;color:${color};margin-left:6px">${sign} $${Math.abs(diff).toLocaleString()}</span>`;
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
  domPenalty:        'DOM−',
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

function chipColor(key: string, pct: number): { bg: string; color: string } {
  if (pct === 0) return { bg: D.border, color: D.muted };
  if (key === 'domPenalty')        return { bg: '#7f1d1d', color: D.red };
  if (key === 'neighborhoodBonus') return { bg: '#14532d', color: D.green };
  if (pct >= 0.7) return { bg: D.green,  color: '#0f1117' };
  if (pct >= 0.4) return { bg: D.yellow, color: '#0f1117' };
  return { bg: D.red, color: '#0f1117' };
}

function scoreChipsHtml(l: NotifyListing): string {
  const bd = parseBreakdown(l.score_breakdown);
  if (!bd) return '';

  const chips = Object.entries(bd.factors).map(([key, { pts, max }]) => {
    const pct = max > 0 ? pts / max : 0;
    const { bg, color } = chipColor(key, pct);
    const label = FACTOR_LABELS[key] ?? key;
    const display = String(Math.round(pct * 100));

    return `<td style="padding:0 1px;text-align:center">
      <div style="background:${bg};color:${color};border-radius:4px;padding:3px 0;font-size:10px;font-weight:700;min-width:28px;text-align:center">${display}</div>
      <div style="font-size:9px;color:${D.muted};margin-top:2px;white-space:nowrap">${label}</div>
    </td>`;
  }).join('');

  return `
    <div style="margin-top:10px">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:${D.muted};margin-bottom:4px">Score breakdown</div>
      <table style="border-collapse:collapse;width:100%"><tr>${chips}</tr></table>
    </div>`;
}

function buildCard(l: NotifyListing): string {
  const img = photoUrl(l.id);
  const { bg: scoreBg, color: scoreColor } = scoreColors(l.score);
  const typeLabel = l.property_type
    ? l.property_type.replace('Single Family Residential', 'SFD')
    : '?';
  const ppsf = l.sqft ? `$${Math.round(l.price / l.sqft)}` : '—';

  return `
  <table style="width:100%;max-width:520px;margin:0 auto 24px;border-collapse:collapse;border:1px solid ${D.border};border-radius:10px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:${D.surface}">
    ${img ? `<tr><td style="padding:0"><img src="${img}" width="520" style="display:block;width:100%;height:200px;object-fit:cover" alt="${l.address}"></td></tr>` : ''}
    <tr>
      <td style="padding:16px">

        <!-- Header: address + score badge -->
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td>
              <div style="font-weight:700;font-size:15px;line-height:1.3;color:${D.text}">${l.address}</div>
              <div style="font-size:12px;color:${D.muted};margin-top:2px">${l.city}, ${l.state} ${l.zip}</div>
              ${l.school_district ? `<div style="font-size:11px;color:${D.accent};margin-top:2px;font-weight:500">${l.school_district}</div>` : ''}
            </td>
            <td style="text-align:right;vertical-align:top;padding-left:12px">
              <div style="display:inline-block;background:${scoreBg};color:${scoreColor};border-radius:8px;width:44px;height:44px;line-height:44px;text-align:center;font-size:17px;font-weight:700">${Math.round(l.score)}</div>
            </td>
          </tr>
        </table>

        <!-- Price -->
        <div style="margin-top:12px">
          <span style="font-size:22px;font-weight:700;color:${D.text}">$${fmt(l.price)}</span>${priceChangeHtml(l)}
          ${l.days_on_market != null ? `<div style="font-size:11px;color:${D.muted};margin-top:1px">${domText(l.days_on_market)}</div>` : ''}
        </div>

        <!-- Stats row -->
        <table style="width:100%;border-collapse:collapse;margin-top:12px">
          <tr>
            <td style="width:25%;padding:7px 8px;background:${D.statBg};border-radius:6px;text-align:center">
              <div style="font-size:13px;font-weight:600;color:${D.text}">${l.beds} / ${l.baths}</div>
              <div style="font-size:10px;color:${D.muted};margin-top:2px;text-transform:uppercase;letter-spacing:.04em">Bed/Bth</div>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;padding:7px 8px;background:${D.statBg};border-radius:6px;text-align:center">
              <div style="font-size:13px;font-weight:600;color:${D.text}">${l.sqft ? fmt(l.sqft) : '—'}</div>
              <div style="font-size:10px;color:${D.muted};margin-top:2px;text-transform:uppercase;letter-spacing:.04em">Sq Ft</div>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;padding:7px 8px;background:${D.statBg};border-radius:6px;text-align:center">
              <div style="font-size:13px;font-weight:600;color:${D.text}">${fmtAcres(l.lot_sqft)}</div>
              <div style="font-size:10px;color:${D.muted};margin-top:2px;text-transform:uppercase;letter-spacing:.04em">Lot</div>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;padding:7px 8px;background:${D.statBg};border-radius:6px;text-align:center">
              <div style="font-size:13px;font-weight:600;color:${D.text}">${ppsf}</div>
              <div style="font-size:10px;color:${D.muted};margin-top:2px;text-transform:uppercase;letter-spacing:.04em">$/Sq Ft</div>
            </td>
          </tr>
        </table>

        <!-- Score chips -->
        ${scoreChipsHtml(l)}

        <!-- Footer: CTA + type pill -->
        <table style="width:100%;border-collapse:collapse;margin-top:14px">
          <tr>
            <td>
              ${l.url ? `<a href="${l.url}" style="display:inline-block;background:${D.accent};color:#fff;text-decoration:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:500">View on Redfin →</a>` : ''}
            </td>
            <td style="text-align:right">
              <span style="font-size:11px;background:${D.statBg};border:1px solid ${D.border};border-radius:20px;padding:3px 10px;color:${D.muted}">${typeLabel}</span>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>`;
}

type ChangeWithListing = import('../db/index.js').ChangeWithListing;

function changeBadgeHtml(c: ChangeWithListing): string {
  if (c.change_type === 'price_drop') {
    const old = parseInt(c.old_value ?? '0');
    const diff = old - c.price;
    return `<div style="margin-bottom:8px">
      <span style="background:#14532d;color:${D.green};padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700">▼ Price Drop</span>
      <span style="font-size:12px;color:${D.muted};margin-left:8px">$${old.toLocaleString()} → <strong style="color:${D.text}">$${c.price.toLocaleString()}</strong> <span style="color:${D.green}">−$${diff.toLocaleString()}</span></span>
    </div>`;
  }
  if (c.change_type === 'price_increase') {
    const old = parseInt(c.old_value ?? '0');
    const diff = c.price - old;
    return `<div style="margin-bottom:8px">
      <span style="background:#7f1d1d;color:${D.red};padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700">▲ Price Increase</span>
      <span style="font-size:12px;color:${D.muted};margin-left:8px">$${old.toLocaleString()} → <strong style="color:${D.text}">$${c.price.toLocaleString()}</strong> <span style="color:${D.red}">+$${diff.toLocaleString()}</span></span>
    </div>`;
  }
  if (c.change_type === 'now_active') {
    return `<div style="margin-bottom:8px">
      <span style="background:#1e3a5f;color:${D.accent};padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700">⚡ Now Active</span>
      <span style="font-size:12px;color:${D.muted};margin-left:8px">Previously coming soon</span>
    </div>`;
  }
  return '';
}

function buildDigestHtml(newListings: NotifyListing[], changes: ChangeWithListing[]): string {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const total = newListings.length + changes.length;

  const newCards = newListings.map(l => `
    <table style="width:100%;max-width:520px;margin:0 auto 6px;border-collapse:collapse"><tr><td>
      <span style="background:#1a2e1a;color:${D.green};padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700">★ New Listing</span>
    </td></tr></table>
    ${buildCard(l)}`).join('');

  const changeCards = changes.map(c => `
    <table style="width:100%;max-width:520px;margin:0 auto 6px;border-collapse:collapse"><tr><td>
      ${changeBadgeHtml(c)}
    </td></tr></table>
    ${buildCard(c)}`).join('');

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:${D.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" bgcolor="${D.bg}">
  <table style="width:100%;border-collapse:collapse" bgcolor="${D.bg}"><tr><td style="padding:24px 16px" bgcolor="${D.bg}">
    <table style="width:100%;max-width:520px;margin:0 auto 24px;border-collapse:collapse">
      <tr><td style="background:${D.surface};border:1px solid ${D.border};border-radius:10px;padding:20px 24px">
        <div style="color:${D.text};font-size:18px;font-weight:700">&#127968; House <span style="color:${D.accent}">Tracker</span></div>
        <div style="color:${D.muted};font-size:13px;margin-top:4px">${total} update${total !== 1 ? 's' : ''} · Score ≥ ${NOTIFY_SCORE_THRESHOLD} · ${date}</div>
      </td></tr>
    </table>
    ${newCards}${changeCards}
    <table style="width:100%;max-width:520px;margin:0 auto;border-collapse:collapse">
      <tr><td style="text-align:center;padding:8px 0"><span style="font-size:11px;color:${D.muted}">Sent by house-tracker</span></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
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
    html: buildDigestHtml(newListings, changes),
  });

  console.log(`[notify] sent digest: ${parts.join(', ')}`);
}
