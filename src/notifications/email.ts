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
  if (!id || !id.startsWith('PAMC')) return null;
  return `https://ssl.cdn-redfin.com/photo/235/mbpaddedwide/${id.slice(-3)}/genMid.${id}_0.jpg`;
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

function sdAbbr(sd: string | null, score: number): string {
  if (!sd) return score >= 20 ? 'Lower Merion' : score > 0 ? 'Secondary SD' : '—';
  if (sd.includes('Lower Merion'))   return 'Lower Merion SD';
  if (sd.includes('Radnor'))         return 'Radnor SD';
  if (sd.includes('Tredyffrin'))     return 'Tredyffrin-Easttown SD';
  if (sd.includes('Haverford'))      return 'Haverford SD';
  if (sd.includes('Upper Merion'))   return 'Upper Merion Area SD';
  if (sd.includes('Great Valley'))   return 'Great Valley SD';
  return sd;
}

const BREAKDOWN_KEYS = [
  { key: 'propertyType',   label: 'Type',   max: 20 },
  { key: 'schoolDistrict', label: 'School', max: 20 },
  { key: 'walkability',    label: 'Walk',   max: 12 },
  { key: 'price',          label: 'Price',  max: 12 },
  { key: 'sqft',           label: 'Sqft',   max: 8  },
  { key: 'lot',            label: 'Lot',    max: 12 },
  { key: 'amtrak',         label: 'Train',  max: 8  },
  { key: 'beds',           label: 'Beds',   max: 4  },
  { key: 'pricePerSqft',   label: '$/sqft', max: 4  },
  { key: 'narberthBonus',  label: 'Narb+',  max: 6  },
  { key: 'domPenalty',     label: 'DOM−',   max: 10 },
] as const;

function chipColor(key: string, val: number, max: number): { bg: string; color: string } {
  if (val === 0) return { bg: D.border, color: D.muted };
  if (key === 'domPenalty')   return { bg: '#7f1d1d', color: D.red };
  if (key === 'narberthBonus') return { bg: '#14532d', color: D.green };
  const pct = val / max;
  if (pct >= 0.7) return { bg: D.green,  color: '#0f1117' };
  if (pct >= 0.4) return { bg: D.yellow, color: '#0f1117' };
  return { bg: D.red, color: '#0f1117' };
}

function scoreChipsHtml(l: NotifyListing): string {
  if (!l.score_breakdown) return '';
  let bd: Record<string, number>;
  try { bd = JSON.parse(l.score_breakdown); } catch { return ''; }

  const chips = BREAKDOWN_KEYS.map(({ key, label, max }) => {
    const val = bd[key] ?? 0;
    const { bg, color } = chipColor(key, val, max);

    let display: string;
    if (key === 'walkability')    display = l.walk_score != null ? String(l.walk_score) : '?';
    else if (key === 'domPenalty') display = l.days_on_market != null ? `${l.days_on_market}d` : '?';
    else if (key === 'pricePerSqft') display = l.sqft ? String(Math.round(l.price / l.sqft)) : '?';
    else if (key === 'schoolDistrict') {
      const sd = l.school_district ?? '';
      if (sd.includes('Lower Merion'))      display = 'LM';
      else if (sd.includes('Radnor'))       display = 'Rad';
      else if (sd.includes('Tredyffrin'))   display = 'T-E';
      else if (sd.includes('Haverford'))    display = 'Hav';
      else if (sd.includes('Upper Merion')) display = 'UM';
      else if (sd.includes('Great Valley')) display = 'GV';
      else if (sd)                          display = 'Oth';
      else                                  display = val >= 20 ? 'LM' : val > 0 ? 'Sec' : '—';
    } else {
      display = String(Math.round((val / max) * 100));
    }

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
              <div style="font-size:12px;color:${D.muted};margin-top:2px">${l.city}, PA ${l.zip}</div>
            </td>
            <td style="text-align:right;vertical-align:top;padding-left:12px">
              <div style="display:inline-block;background:${scoreBg};color:${scoreColor};border-radius:8px;width:44px;height:44px;line-height:44px;text-align:center;font-size:17px;font-weight:700">${Math.round(l.score)}</div>
            </td>
          </tr>
        </table>

        <!-- Price -->
        <div style="margin-top:12px">
          <span style="font-size:22px;font-weight:700;color:${D.text}">$${fmt(l.price)}</span>${priceChangeHtml(l)}
          <div style="font-size:11px;color:${D.muted};margin-top:1px">${sdAbbr(l.school_district, 0)}</div>
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

        <!-- DOM -->
        ${l.days_on_market != null ? `<div style="margin-top:8px">${domText(l.days_on_market)}</div>` : ''}

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

function buildHtml(listings: NotifyListing[]): string {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const cards = listings.map(buildCard).join('');

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:${D.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table style="width:100%;border-collapse:collapse">
    <tr>
      <td style="padding:24px 16px">

        <!-- Header -->
        <table style="width:100%;max-width:520px;margin:0 auto 24px;border-collapse:collapse">
          <tr>
            <td style="background:${D.surface};border:1px solid ${D.border};border-radius:10px;padding:20px 24px">
              <div style="color:${D.text};font-size:18px;font-weight:700;margin:0">&#127968; House <span style="color:${D.accent}">Tracker</span></div>
              <div style="color:${D.muted};font-size:13px;margin-top:4px">${listings.length} new listing${listings.length !== 1 ? 's' : ''} · Score ≥ ${NOTIFY_SCORE_THRESHOLD} · ${date}</div>
            </td>
          </tr>
        </table>

        <!-- Cards -->
        ${cards}

        <!-- Footer -->
        <table style="width:100%;max-width:520px;margin:0 auto;border-collapse:collapse">
          <tr>
            <td style="text-align:center;padding:8px 0">
              <span style="font-size:11px;color:${D.muted}">Sent by house-tracker</span>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildChangesHtml(changes: import('../db/index.js').ChangeWithListing[]): string {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const rows = changes.map(c => {
    let badge = '';
    let detail = '';
    if (c.change_type === 'price_drop') {
      const old = parseInt(c.old_value ?? '0');
      const diff = old - c.price;
      badge = `<span style="background:#14532d;color:${D.green};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">▼ Price Drop</span>`;
      detail = `$${old.toLocaleString()} → <strong>$${c.price.toLocaleString()}</strong> <span style="color:${D.green}">−$${diff.toLocaleString()}</span>`;
    } else if (c.change_type === 'price_increase') {
      const old = parseInt(c.old_value ?? '0');
      const diff = c.price - old;
      badge = `<span style="background:#7f1d1d;color:${D.red};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">▲ Price Increase</span>`;
      detail = `$${old.toLocaleString()} → <strong>$${c.price.toLocaleString()}</strong> <span style="color:${D.red}">+$${diff.toLocaleString()}</span>`;
    } else if (c.change_type === 'now_active') {
      badge = `<span style="background:#1e3a5f;color:${D.accent};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">⚡ Now Active</span>`;
      detail = `Previously coming soon — now active at <strong>$${c.price.toLocaleString()}</strong>`;
    }

    const { bg: scoreBg, color: scoreColor } = scoreColors(c.score);
    return `
    <table style="width:100%;max-width:520px;margin:0 auto 12px;border-collapse:collapse;border:1px solid ${D.border};border-radius:10px;background:${D.surface};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <tr><td style="padding:14px 16px">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td>
              <div style="margin-bottom:6px">${badge}</div>
              <div style="font-weight:700;font-size:14px;color:${D.text}">${c.address}</div>
              <div style="font-size:12px;color:${D.muted};margin-top:2px">${c.city}, PA ${c.zip} · ${c.beds}bd / ${c.baths}ba${c.sqft ? ' · ' + c.sqft.toLocaleString() + ' sqft' : ''}</div>
              <div style="font-size:13px;color:${D.text};margin-top:8px">${detail}</div>
            </td>
            <td style="text-align:right;vertical-align:top;padding-left:12px">
              <div style="display:inline-block;background:${scoreBg};color:${scoreColor};border-radius:8px;width:40px;height:40px;line-height:40px;text-align:center;font-size:15px;font-weight:700">${Math.round(c.score)}</div>
            </td>
          </tr>
        </table>
        ${c.url ? `<div style="margin-top:10px"><a href="${c.url}" style="display:inline-block;background:${D.accent};color:#fff;text-decoration:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:500">View on Redfin →</a></div>` : ''}
      </td></tr>
    </table>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:${D.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 16px">
    <table style="width:100%;max-width:520px;margin:0 auto 24px;border-collapse:collapse">
      <tr><td style="background:${D.surface};border:1px solid ${D.border};border-radius:10px;padding:20px 24px">
        <div style="color:${D.text};font-size:18px;font-weight:700">&#127968; House <span style="color:${D.accent}">Tracker</span></div>
        <div style="color:${D.muted};font-size:13px;margin-top:4px">${changes.length} update${changes.length !== 1 ? 's' : ''} · ${date}</div>
      </td></tr>
    </table>
    ${rows}
    <table style="width:100%;max-width:520px;margin:0 auto;border-collapse:collapse">
      <tr><td style="text-align:center;padding:8px 0"><span style="font-size:11px;color:${D.muted}">Sent by house-tracker</span></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export async function sendChangesDigest(changes: import('../db/index.js').ChangeWithListing[]): Promise<void> {
  if (!isConfigured() || changes.length === 0) return;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const priceDrop = changes.filter(c => c.change_type === 'price_drop').length;
  const priceUp   = changes.filter(c => c.change_type === 'price_increase').length;
  const active    = changes.filter(c => c.change_type === 'now_active').length;
  const parts = [
    priceDrop && `${priceDrop} price drop${priceDrop > 1 ? 's' : ''}`,
    priceUp   && `${priceUp} price increase${priceUp > 1 ? 's' : ''}`,
    active    && `${active} now active`,
  ].filter(Boolean);

  await transporter.sendMail({
    from: `"House Tracker" <${SMTP_USER}>`,
    to: NOTIFY_TO,
    subject: `🏠 Listing updates: ${parts.join(' · ')}`,
    html: buildChangesHtml(changes),
  });

  console.log(`[notify] sent changes digest: ${parts.join(', ')}`);
}

export async function sendNewListingsDigest(listings: NotifyListing[]): Promise<void> {
  if (!isConfigured()) {
    console.log('[notify] SMTP not configured — skipping email');
    return;
  }
  if (listings.length === 0) return;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const subject = listings.length === 1
    ? `🏠 New listing: ${listings[0].address} (score ${Math.round(listings[0].score)})`
    : `🏠 ${listings.length} new listings above score ${NOTIFY_SCORE_THRESHOLD}`;

  await transporter.sendMail({
    from: `"House Tracker" <${SMTP_USER}>`,
    to: NOTIFY_TO,
    subject,
    html: buildHtml(listings),
  });

  console.log(`[notify] sent digest for ${listings.length} listing(s) to ${NOTIFY_TO}`);
}
