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
