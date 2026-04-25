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

// Dark theme palette (matches dashboard dark mode)
const D = {
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
  if (score >= 80) return { bg: 'rgba(74,158,114,0.12)', color: D.green };
  if (score >= 60) return { bg: 'rgba(196,145,58,0.12)', color: D.yellow };
  return { bg: 'rgba(192,90,71,0.12)', color: D.red };
}

function domLabel(dom: number | null): string {
  if (dom == null) return '';
  if (dom > 120) return `<span style="color:${D.red};font-weight:600">(⚠ ${dom} d)</span>`;
  if (dom > 30)  return `<span style="color:${D.yellow};font-weight:600">(~${dom} d)</span>`;
  return `<span style="color:${D.muted}">(${dom} d)</span>`;
}

function listedLine(l: NotifyListing): string {
  const date = l.first_seen_at ? new Date(l.first_seen_at).toLocaleDateString() : '—';
  const dom = l.days_on_market != null ? ` · ${domLabel(l.days_on_market)}` : '';
  return `<div style="font-size:11px;color:${D.muted};margin-top:2px">Listed ${date}${dom}</div>`;
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
  zipBonus:          'Zip+',
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
  if (pct === 0) return { bg: D.statBg, color: D.muted };
  if (key === 'domPenalty')        return { bg: D.red,   color: '#fff' };
  if (key === 'neighborhoodBonus') return { bg: D.green, color: '#fff' };
  if (pct >= 0.7) return { bg: D.green,  color: '#fff' };
  if (pct >= 0.4) return { bg: D.yellow, color: '#fff' };
  return { bg: D.red, color: '#fff' };
}

function scoreChipsHtml(l: NotifyListing): string {
  const bd = parseBreakdown(l.score_breakdown);
  if (!bd) return '';

  const chips = Object.entries(bd.factors).map(([key, { pts, max }]) => {
    const pct = max > 0 ? pts / max : 0;
    const { bg, color } = chipColor(key, pct);
    const label = FACTOR_LABELS[key] ?? key;
    const display = String(Math.round(pct * 100));

    return `<td style="padding:0 2px;text-align:center;vertical-align:top">
      <div style="background:${bg};color:${color};border-radius:3px;height:20px;line-height:20px;font-size:9px;font-weight:700;text-align:center;white-space:nowrap;padding:0 2px">${display}</div>
      <div style="font-size:8px;color:${D.muted};margin-top:3px;white-space:nowrap;text-align:center">${label}</div>
    </td>`;
  }).join('');

  return `
    <div style="margin-top:12px">
      <div style="font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:${D.muted};margin-bottom:5px">Score Breakdown</div>
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
            <td style="vertical-align:top">
              <div style="font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:18px;line-height:1.25;color:${D.text}">${l.address}</div>
              <div style="font-size:11px;color:${D.muted};margin-top:4px">${l.city}, ${l.state} ${l.zip}</div>
              ${l.school_district ? `<div style="font-size:10px;color:${D.accent};margin-top:5px;font-weight:500;letter-spacing:.02em">${l.school_district}</div>` : ''}
            </td>
            <td style="text-align:right;vertical-align:top;padding-left:12px">
              <div style="display:inline-block;background:${scoreBg};border:1px solid ${scoreColor};color:${scoreColor};border-radius:50%;width:48px;height:48px;line-height:46px;text-align:center;font-size:16px;font-weight:700;font-family:'Courier New',monospace">${Math.round(l.score)}</div>
            </td>
          </tr>
        </table>

        <!-- Price -->
        <div style="margin-top:14px">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:400;color:${D.text}">$${fmt(l.price)}</span>${priceChangeHtml(l)}
          ${listedLine(l)}
        </div>

        <!-- Stats row -->
        <table style="width:100%;border-collapse:collapse;margin-top:12px">
          <tr>
            <td style="width:25%;padding:7px 8px;background:${D.statBg};border-radius:5px">
              <div style="font-family:'Courier New',monospace;font-size:12px;font-weight:700;color:${D.text}">${l.beds} / ${l.baths}</div>
              <div style="font-size:9px;color:${D.muted};margin-top:2px;text-transform:uppercase;letter-spacing:.05em">Bed / Bth</div>
            </td>
            <td style="width:5px"></td>
            <td style="width:25%;padding:7px 8px;background:${D.statBg};border-radius:5px">
              <div style="font-family:'Courier New',monospace;font-size:12px;font-weight:700;color:${D.text}">${l.sqft ? fmt(l.sqft) : '—'}</div>
              <div style="font-size:9px;color:${D.muted};margin-top:2px;text-transform:uppercase;letter-spacing:.05em">Sq Ft</div>
            </td>
            <td style="width:5px"></td>
            <td style="width:25%;padding:7px 8px;background:${D.statBg};border-radius:5px">
              <div style="font-family:'Courier New',monospace;font-size:12px;font-weight:700;color:${D.text}">${fmtAcres(l.lot_sqft)}</div>
              <div style="font-size:9px;color:${D.muted};margin-top:2px;text-transform:uppercase;letter-spacing:.05em">Lot</div>
            </td>
            <td style="width:5px"></td>
            <td style="width:25%;padding:7px 8px;background:${D.statBg};border-radius:5px">
              <div style="font-family:'Courier New',monospace;font-size:12px;font-weight:700;color:${D.text}">${ppsf}</div>
              <div style="font-size:9px;color:${D.muted};margin-top:2px;text-transform:uppercase;letter-spacing:.05em">$/Sq Ft</div>
            </td>
          </tr>
        </table>

        <!-- Score chips -->
        ${scoreChipsHtml(l)}

        <!-- Footer: CTA + type pill -->
        <table style="width:100%;border-collapse:collapse;margin-top:14px">
          <tr>
            <td style="width:100%">
              ${l.url ? `<a href="${l.url}" style="display:block;width:100%;background:${D.accent};color:#fff;text-decoration:none;border-radius:5px;padding:8px 0;font-size:12px;font-weight:600;letter-spacing:.03em;text-align:center;box-sizing:border-box">View on Redfin →</a>` : ''}
            </td>
            <td style="white-space:nowrap;padding-left:8px;vertical-align:middle">
              <span style="font-size:10px;background:${D.statBg};border:1px solid ${D.border};border-radius:20px;padding:3px 10px;color:${D.muted};font-weight:500;letter-spacing:.03em">${typeLabel}</span>
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
      <span style="background:rgba(74,158,114,0.12);color:${D.green};border:1px solid rgba(74,158,114,0.3);padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">▼ Price Drop</span>
      <span style="font-size:12px;color:${D.muted};margin-left:8px">$${old.toLocaleString()} → <strong style="color:${D.text}">$${c.price.toLocaleString()}</strong> <span style="color:${D.green}">−$${diff.toLocaleString()}</span></span>
    </div>`;
  }
  if (c.change_type === 'price_increase') {
    const old = parseInt(c.old_value ?? '0');
    const diff = c.price - old;
    return `<div style="margin-bottom:8px">
      <span style="background:rgba(192,90,71,0.12);color:${D.red};border:1px solid rgba(192,90,71,0.3);padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">▲ Price Increase</span>
      <span style="font-size:12px;color:${D.muted};margin-left:8px">$${old.toLocaleString()} → <strong style="color:${D.text}">$${c.price.toLocaleString()}</strong> <span style="color:${D.red}">+$${diff.toLocaleString()}</span></span>
    </div>`;
  }
  if (c.change_type === 'now_active') {
    return `<div style="margin-bottom:8px">
      <span style="background:rgba(196,145,58,0.12);color:${D.accent};border:1px solid rgba(196,145,58,0.3);padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">⚡ Now Active</span>
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
      <span style="background:rgba(74,158,114,0.12);color:${D.green};border:1px solid rgba(74,158,114,0.3);padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">★ New Listing</span>
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
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:${D.text}">HOUSE <span style="color:${D.accent}">TRACKER</span></div>
        <div style="font-family:'Courier New',monospace;color:${D.muted};font-size:12px;margin-top:6px">${total} update${total !== 1 ? 's' : ''} · score ≥ ${NOTIFY_SCORE_THRESHOLD} · ${date}</div>
      </td></tr>
    </table>
    ${newCards}${changeCards}
    <table style="width:100%;max-width:520px;margin:0 auto;border-collapse:collapse">
      <tr><td style="text-align:center;padding:8px 0"><span style="font-size:10px;color:${D.muted};letter-spacing:.04em">house-tracker</span></td></tr>
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
