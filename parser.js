const XLSX = require('xlsx');

// pdfjs-dist v4 cuma tersedia sebagai ESM, jadi di-load pakai dynamic import()
// dan hasil modulnya di-cache biar tidak di-import ulang tiap request.
let pdfjsLibPromise = null;
function getPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLibPromise;
}

// Label-label yang ada di form Job Profile Sherly, beserta beberapa variasi
// penulisan (biar parsing tetap jalan walau ada sedikit perbedaan format).
const FIELD_DEFS = [
  { key: 'job_title', labels: ['job title'] },
  { key: 'department', labels: ['department'] },
  { key: 'direct_report_to', labels: ['direct report to', 'direct reports to'] },
  { key: 'org_structure_position', labels: ['position in org.structure chart', 'position in org structure chart', 'position in organization structure chart'] },
  { key: 'position_type', labels: ['position type'] },
  { key: 'placement', labels: ['placement'] },
  { key: 'office_hours', labels: ['office hours'] },
  { key: 'travel_required', labels: ['travel required'] },
  { key: 'job_description', labels: ['job descriptions', 'job description'] },
  { key: 'job_requirements', labels: ['job requirements', 'job requirement'] },
  { key: 'preferred_skills', labels: ['preferred skills', 'preferred skill'] },
  { key: 'special_requirements', labels: ['special requirements', 'special requirement'] },
  { key: 'salary_range', labels: ['salary range'] },
];

const ALL_LABELS = FIELD_DEFS.flatMap((f) => f.labels);

function norm(s) {
  return (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}

// Cari label mana (kalau ada) yang jadi awal dari sebuah baris teks, misal
// baris "Job Title : General Manager" -> cocok dengan label "job title".
function matchLabelAtStart(lineNorm) {
  let best = null;
  for (const def of FIELD_DEFS) {
    for (const label of def.labels) {
      if (lineNorm === label || lineNorm.startsWith(label + ' ') || lineNorm.startsWith(label + ':')) {
        if (!best || label.length > best.label.length) best = { key: def.key, label };
      }
    }
  }
  return best;
}

// Ambil isi value setelah label di satu baris, misal dari
// "Job Title : General Manager" -> "General Manager". Handle juga
// baris checkbox seperti "Position Type : v Full Time  Contract  Part Time".
function extractInlineValue(line, label) {
  const idx = norm(line).indexOf(label);
  let rest = line.slice(idx + label.length);
  rest = rest.replace(/^[\s:.\-]+/, '');
  return rest.trim();
}

// Deteksi opsi tercentang pada baris checkbox (Position Type / Travel Required).
// Baris ini biasanya berbentuk "Label : v Opsi1  Opsi2  Opsi3" di mana "v"
// (atau x/✓) menandai opsi yang aktif. Excel/PDF export bisa memisahkan opsi
// dengan tab, spasi ganda, atau cuma satu spasi (tergantung sumbernya), jadi
// baris dinormalisasi dulu ke single-space sebelum dicari tanda centangnya.
function extractCheckedOption(rawLine, options) {
  const flat = rawLine.replace(/[\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

  const markRegex = /(^|\s)(v|x|✓|✔)(\s|$)/i;
  const m = flat.match(markRegex);
  if (m) {
    const after = flat.slice(m.index + m[0].length - (m[3] ? m[3].length : 0)).trim();
    const sorted = [...options].sort((a, b) => b.length - a.length);
    const hit = sorted.find((opt) => norm(after).startsWith(norm(opt)));
    if (hit) return hit;
  }

  // Fallback: kalau tidak ketemu pola tanda centang, tapi cuma satu opsi yang
  // disebut di baris tsb, anggap itu yang dipilih.
  const mentioned = options.filter((opt) => norm(rawLine).includes(norm(opt)));
  if (mentioned.length === 1) return mentioned[0];
  return null;
}

/**
 * Parser utama: menerima array baris teks (tiap baris = 1 baris form) dan
 * mengembalikan object field hasil ekstraksi.
 */
function parseLines(lines) {
  const result = {};
  FIELD_DEFS.forEach((f) => { result[f.key] = ''; });

  let currentKey = null;
  let buffer = [];

  const flush = () => {
    if (currentKey) {
      const text = buffer.join('\n').trim();
      result[currentKey] = result[currentKey] ? `${result[currentKey]}\n${text}` : text;
    }
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r/g, '');
    if (!line.trim()) continue;
    const lineNorm = norm(line);

    const match = matchLabelAtStart(lineNorm);
    if (match) {
      flush();
      currentKey = match.key;

      if (match.key === 'position_type') {
        const opt = extractCheckedOption(line, ['Full Time', 'Contract', 'Part Time', 'Project Based']);
        result.position_type = opt || extractInlineValue(line, match.label);
        currentKey = null;
        continue;
      }
      if (match.key === 'travel_required') {
        const opt = extractCheckedOption(line, ['Yes', 'No']);
        result.travel_required = opt || extractInlineValue(line, match.label);
        currentKey = null;
        continue;
      }

      const inline = extractInlineValue(line, match.label);
      if (inline) buffer.push(inline);
      continue;
    }

    if (currentKey) {
      buffer.push(line.trim());
    }
  }
  flush();

  // Bersihkan tanda kutip pembungkus yang kadang ikut ke-export dari Excel.
  for (const key of Object.keys(result)) {
    result[key] = result[key].replace(/^"+|"+$/g, '').trim();
  }

  return result;
}

async function parseXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

  const lines = rows.map((row) =>
    row.map((c) => (c === null || c === undefined ? '' : String(c))).join('\t')
  );

  return parseLines(lines);
}

async function extractPdfLines(buffer) {
  const pdfjsLib = await getPdfjs();
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  const lines = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    let lastY = null;
    let currentLine = '';
    for (const item of content.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(currentLine);
        currentLine = '';
      }
      currentLine += (currentLine && !currentLine.endsWith(' ') ? ' ' : '') + item.str;
      lastY = y;
    }
    if (currentLine.trim()) lines.push(currentLine);
  }
  return lines;
}

async function parsePdf(buffer) {
  const lines = await extractPdfLines(buffer);
  return parseLines(lines);
}

async function parseJobFile(buffer, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') {
    return parseXlsx(buffer);
  }
  if (ext === 'pdf') {
    return parsePdf(buffer);
  }
  throw new Error('Format file tidak didukung. Upload file .xlsx atau .pdf.');
}

module.exports = { parseJobFile, parseLines, FIELD_DEFS };
