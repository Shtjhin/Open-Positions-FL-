async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function escapeHtml(str) {
  return (str || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Render free-text as a bullet list (one point per line) for fields like Job
// Description, Requirements, Preferred Skills, and Special Requirements.
// Falls back to a plain dash when there's no content.
function renderBullets(text) {
  if (!text || !text.trim()) return '<div class="v">-</div>';
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^[\s]*[-*•]\s*/, '').trim())
    .filter(Boolean);
  if (!lines.length) return '<div class="v">-</div>';
  return `<ul class="bullet-list">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;
}

// ---------- SALARY RANGE (currency + thousand-separated amounts) ----------
// Shared by admin.js (the editable currency/min/max inputs) and
// freelancer.js (read-only display) so a job's salary always renders with
// the same "Rp 15.000.000 - Rp 20.000.000" formatting regardless of what
// raw text happened to get stored — including jobs saved before this
// formatting existed, without needing the admin to re-open and re-save
// every one of them.

// Strips everything but digits, then re-inserts "." as the thousands
// separator (Indonesian convention) — e.g. "15000000" becomes "15.000.000".
function formatThousands(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Best-effort parse of a salary range string (freshly composed, or old raw
// text from before this UI existed / parsed from a file) into
// {currency, min, max}. Falls back to keeping the whole original string in
// `min` under "Other" rather than silently dropping anything unrecognized.
function parseSalaryRange(raw) {
  const text = (raw || '').trim();
  if (!text) return { currency: 'Rp', min: '', max: '' };

  const currencyMatch = text.match(/^(Rp\.?|IDR|US\$|USD|S\$|SGD|\$)\s*/i);
  let currency = 'Other';
  let rest = text;
  if (currencyMatch) {
    const tag = currencyMatch[1].toUpperCase().replace(/\./g, '');
    if (tag === 'RP' || tag === 'IDR') currency = 'Rp';
    else if (tag === 'USD' || tag === 'US$' || tag === '$') currency = 'USD';
    else if (tag === 'SGD' || tag === 'S$') currency = 'SGD';
    rest = text.slice(currencyMatch[0].length);
  }

  const parts = rest.split(/\s*[-–—]\s*/);
  // Sherly sometimes writes salaries in shorthand ("10jt" / "500rb" for 10
  // million / 500 thousand) instead of the full number — expand those to
  // the full figure before formatting, rather than silently truncating
  // "10jt" down to just "10".
  const clean = (s) => {
    const str = (s || '').replace(/^(Rp\.?|IDR|US\$|USD|S\$|SGD|\$)\s*/i, '').trim();
    const shorthand = str.match(/^(\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu)\b/i);
    if (shorthand) {
      const num = parseFloat(shorthand[1].replace(',', '.'));
      const mult = /^(jt|juta)$/i.test(shorthand[2]) ? 1000000 : 1000;
      return Number.isNaN(num) ? '' : String(Math.round(num * mult));
    }
    return str.replace(/\D/g, '');
  };
  const min = formatThousands(clean(parts[0]));
  const max = parts.length > 1 ? formatThousands(clean(parts[1])) : '';

  if (!min && !max) {
    return { currency: 'Other', min: text, max: '' };
  }
  return { currency: currencyMatch ? currency : 'Rp', min, max };
}

// Composes the final salary_range text from a currency/min/max triple
// (e.g. "Rp 15.000.000 - Rp 20.000.000").
function composeSalaryText(currency, min, max) {
  if (!min && !max) return '';
  const label = currency === 'Other' ? '' : `${currency} `;
  if (min && max) return `${label}${min} - ${label}${max}`.trim();
  return `${label}${min || max}`.trim();
}

// Re-renders a stored salary_range string with consistent thousand-
// separator formatting for read-only display, whatever raw shape it was
// saved in.
function formatSalaryDisplay(raw) {
  if (!raw || !raw.trim()) return '';
  const { currency, min, max } = parseSalaryRange(raw);
  return composeSalaryText(currency, min, max) || raw.trim();
}
