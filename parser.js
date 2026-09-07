const XLSX = require('xlsx');
const mammoth = require('mammoth');
const { parse: parseHtml } = require('node-html-parser');

// pdfjs-dist v4 cuma tersedia sebagai ESM, jadi di-load pakai dynamic import()
// dan hasil modulnya di-cache biar tidak di-import ulang tiap request.
let pdfjsLibPromise = null;
function getPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((lib) => {
      // pdfjs-dist tries to spin up a "fake worker" in Node by dynamically
      // resolving pdf.worker.mjs at runtime. Vercel's serverless build only
      // bundles files it can see being referenced statically, so that
      // dynamic lookup isn't included and fails at runtime with "Cannot
      // find module '.../pdf.worker.mjs'". Pointing workerSrc at it via
      // require.resolve() (a static reference Vercel's bundler does trace)
      // makes sure the worker file actually ships with the deployment.
      try {
        lib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      } catch (e) {
        // If this ever fails, fall back to whatever pdfjs-dist does by default.
      }
      return lib;
    });
  }
  return pdfjsLibPromise;
}

// Label-label yang ada di form Job Profile Sherly, beserta beberapa variasi
// penulisan (biar parsing tetap jalan walau ada sedikit perbedaan format).
const FIELD_DEFS = [
  { key: 'job_title', labels: ['job title'] },
  { key: 'department', labels: ['department'] },
  { key: 'direct_report_to', labels: ['direct report to', 'direct reports to'] },
  { key: 'position_type', labels: ['position type'] },
  { key: 'placement', labels: ['placement'] },
  { key: 'office_hours', labels: ['office hours'] },
  { key: 'working_days', labels: ['working days', 'working day'] },
  { key: 'travel_required', labels: ['travel required'] },
  // "Job Overview" is a distinct field from the actual description bullets —
  // some of Sherly's templates give it its own row/label right before "Job
  // Descriptions" and expect it to stay a separate paragraph, not get mixed
  // in with the responsibilities list.
  { key: 'job_overview', labels: ['job overview', 'position overview', 'role overview'] },
  // "Job Responsibilities" is what some templates call the actual bulleted
  // description content — recognized as an alias for job_description below.
  // Some of Sherly's simpler "job ad" style PDFs (just a title + two bullet
  // sections, no full intake form) use the bare word "Responsibilities" as
  // the section header instead, so that's recognized too.
  { key: 'job_description', labels: ['job descriptions', 'job description', 'job responsibilities', 'responsibilities'] },
  // Those same simple job-ad PDFs label the second section just
  // "Requirements" or "Qualification(s)" with no "Job" in front — recognized
  // as aliases here so that content doesn't fall through and get glued onto
  // the end of Job Description instead.
  { key: 'job_requirements', labels: ['job requirements', 'job requirement', 'requirements', 'requirement', 'qualifications', 'qualification'] },
  { key: 'preferred_skills', labels: ['preferred skills', 'preferred skill'] },
  { key: 'special_requirements', labels: ['special requirements', 'special requirement'] },
  { key: 'salary_range', labels: ['salary range'] },
  { key: 'additional_notes', labels: ['additional notes', 'additional note'] },
];

const ALL_LABELS = FIELD_DEFS.flatMap((f) => f.labels);

function norm(s) {
  return (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}

// Fields that should always come out as one clean point per line (Job
// Description, Job Requirements, Preferred Skills, Special Requirements).
// Source files are messy in practice: bullets get flattened onto a single
// row by Excel/PDF export, use inconsistent markers (-, *, •, "1.", "a)"),
// or mix extra whitespace. This normalizes all of that into tidy lines so
// the admin doesn't have to manually clean it up before it hits the form.
const BULLET_MARKER = /^[\s]*[-*•●▪‣·○]\s*/;
const NUMBER_MARKER = /^[\s]*\(?\d{1,2}[.).]\s+/;
const LETTER_MARKER = /^[\s]*\(?[a-zA-Z][.).]\s+/;
// Matches a bullet/number/letter marker that starts a new point mid-line —
// only where it's preceded by the start of the line or a run of 2+ spaces
// (the tell-tale sign of a flattened column/bullet break from Excel or PDF
// export), so an ordinary " - " or "5+ years" inside a sentence is left alone.
const INLINE_MARKER_SPLIT = /(?=(?:^|\s{2,})(?:[-*•●▪‣·○]\s*|\(?\d{1,2}[.).]\s+|\(?[a-zA-Z][.).]\s+))/g;

function stripBulletMarker(line) {
  // PDF text extraction joins words that were visually spaced apart
  // (justified text, table cell gaps) with plain single spaces item-by-item,
  // which can leave doubled-up spaces in the middle of a sentence (e.g.
  // "supervise  utilities construction" instead of "supervise utilities
  // construction"). Collapsing runs of spaces/tabs here cleans that up
  // without touching the newlines that separate points.
  return line.replace(BULLET_MARKER, '').replace(NUMBER_MARKER, '').replace(LETTER_MARKER, '').replace(/[ \t]{2,}/g, ' ').trim();
}

function cleanBulletText(raw) {
  if (!raw) return '';
  const points = [];
  for (const rawLine of raw.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // A single physical line sometimes contains several bullets that got
    // stitched together (common with PDF text extraction) — split those
    // back apart wherever another bullet marker appears mid-line.
    const segments = line.split(INLINE_MARKER_SPLIT).map((s) => s.trim()).filter(Boolean);
    for (const seg of segments.length > 1 ? segments : [line]) {
      const cleaned = stripBulletMarker(seg);
      if (cleaned) points.push(cleaned);
    }
  }
  return points.join('\n');
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
  // Sherly also uses simpler "job ad" style PDFs — just a title line
  // followed straight into "Job Description" / "Requirements" sections,
  // with no "Job Title :" row at all. Without any label to hang the title
  // off of, job_title used to come out blank. Capture the very first line
  // of the file, before any recognized label has been seen, as a fallback —
  // it's only ever used at the end if the real "Job Title" label never
  // showed up anywhere in the document.
  let titleCandidate = null;
  let sawAnyLabel = false;

  const flush = () => {
    if (currentKey) {
      const text = buffer.join('\n').trim();
      result[currentKey] = result[currentKey] ? `${result[currentKey]}\n${text}` : text;
    }
    buffer = [];
  };

  // Fields whose answer is expected on a single row, right after the label
  // (Job Title, Placement, Direct Report To, etc.). These are closed
  // immediately after their inline value is captured, instead of staying
  // "open" for continuation lines like the long bullet fields do. Without
  // this, a row whose own label isn't recognized (e.g. a stray "Position in
  // Org.Structure Chart" row with no matching field) silently gets appended
  // onto whatever single-value field came right before it in the file,
  // corrupting it — that's what was happening to Direct Report To.
  const SINGLE_LINE_KEYS = new Set([
    'job_title', 'department', 'direct_report_to',
    'placement', 'office_hours', 'working_days', 'salary_range', 'additional_notes',
  ]);

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r/g, '');
    if (!line.trim()) continue;
    const lineNorm = norm(line);

    const match = matchLabelAtStart(lineNorm);
    if (match) {
      sawAnyLabel = true;
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

      if (SINGLE_LINE_KEYS.has(match.key)) {
        flush();
        currentKey = null;
      }
      continue;
    }

    if (!sawAnyLabel && !currentKey && !titleCandidate) {
      titleCandidate = line.trim();
      continue;
    }

    if (currentKey) {
      buffer.push(line.trim());
    }
  }
  flush();

  if (!result.job_title && titleCandidate) {
    result.job_title = titleCandidate;
  }

  // Strip stray wrapping quotes that sometimes come through from Excel
  // exports, and collapse any doubled-up spaces left over from PDF text
  // extraction (newlines between points are untouched).
  for (const key of Object.keys(result)) {
    result[key] = result[key].replace(/^"+|"+$/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  }

  // Detect Nett/Gross inside the Salary Range text (e.g. "Rp 10jt - 15jt (Nett)")
  // and split it out into its own field instead of leaving it mixed into the range text.
  result.salary_type = '';
  if (result.salary_range) {
    const m = result.salary_range.match(/\b(nett|gross)\b/i);
    if (m) {
      result.salary_type = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
      result.salary_range = result.salary_range
        .replace(/[\(\[]?\s*(nett|gross)\s*[\)\]]?/i, '')
        .replace(/[\s\-,]+$/, '')
        .trim();
    }
  }

  // Placement is meant to be just the location (e.g. "Jakarta / Head
  // Office") — some forms tack on a note about travel/exhibitions after an
  // en dash or hyphen on the same cell (e.g. "... – dengan perjalanan
  // supplier visit..."). Keep only the location; the note isn't something a
  // freelancer needs in that field.
  if (result.placement) {
    const parts = result.placement.split(/\s[–—-]\s/);
    if (parts.length > 1) result.placement = parts[0].trim();
  }

  // Normalize the long-text fields into one clean point per line.
  result.job_overview = cleanBulletText(result.job_overview);
  result.job_description = cleanBulletText(result.job_description);
  result.job_requirements = cleanBulletText(result.job_requirements);
  result.preferred_skills = cleanBulletText(result.preferred_skills);
  result.special_requirements = cleanBulletText(result.special_requirements);

  // Additional Notes is intentionally left blank after parsing — Sherly fills
  // this one in manually for every job, so whatever the source file has under
  // that label is discarded here (the label is still recognized above so it
  // doesn't get swallowed into whatever field precedes it in the file).
  result.additional_notes = '';

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

// Word docs (.docx) aren't always a table like the Excel intake form — some
// of Sherly's templates are just paragraphs and bullet lists (like the
// simpler "job ad" PDFs). mammoth turns the docx into HTML, which we then
// walk into the same flat "one line per row/paragraph/bullet" shape that
// parseLines() already expects from the xlsx/PDF paths, so all the same
// label-matching and bullet-cleanup logic applies unchanged.
function htmlToLines(html) {
  const root = parseHtml(html);
  const lines = [];

  function walk(node) {
    if (!node || node.nodeType !== 1) return; // element nodes only
    const tag = (node.rawTagName || '').toLowerCase();

    if (tag === 'table') {
      // Sherly's structured intake form is a two-column label/value table —
      // join each row's cells with a tab, matching how the xlsx path turns
      // spreadsheet rows into lines (so "Job Title" and its answer land on
      // the same line for matchLabelAtStart to recognize).
      node.querySelectorAll('tr').forEach((tr) => {
        const cells = tr.querySelectorAll('td, th').map((c) => c.text.trim());
        const line = cells.join('\t');
        if (line.trim()) lines.push(line);
      });
      return;
    }

    if (tag === 'li') {
      const text = node.text.trim();
      if (text) lines.push('• ' + text);
      return;
    }

    if (tag === 'p' || /^h[1-6]$/.test(tag)) {
      const text = node.text.trim();
      if (text) lines.push(text);
      return;
    }

    // Container element (div, ul, ol, body, etc.) — recurse in document order.
    node.childNodes.forEach(walk);
  }

  walk(root);
  return lines;
}

async function parseDocx(buffer) {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const lines = htmlToLines(html);
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

    // pdfjs hands back text items in whatever order the PDF's content
    // stream stores them, which isn't always left-to-right/top-to-bottom —
    // sort by Y (top to bottom) then X (left to right) so a row reads
    // correctly even if the source PDF emitted its cells/runs out of order.
    const items = content.items
      .filter((it) => it.str !== undefined && it.str !== '')
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width || 0 }))
      .sort((a, b) => b.y - a.y || a.x - b.x);

    // Group items into visual rows (same Y, within a small tolerance),
    // joining each row's text left to right.
    const rows = [];
    let currentRow = null;
    for (const it of items) {
      if (!currentRow || Math.abs(it.y - currentRow.y) > 2) {
        currentRow = { y: it.y, items: [] };
        rows.push(currentRow);
      }
      currentRow.items.push(it);
    }
    const rowTexts = rows
      .map((row) => {
        row.items.sort((a, b) => a.x - b.x);
        // Only insert a space between two items when there's an actual
        // horizontal gap between them — most word breaks already carry
        // their own explicit space item, so blindly inserting one between
        // every pair of items (the old approach) doubled up spaces and even
        // padded gapless punctuation like "(Utilities)" into "( Utilities )".
        let text = '';
        let lastEndX = null;
        for (const it of row.items) {
          if (lastEndX !== null && it.x - lastEndX > 1 && !text.endsWith(' ')) {
            text += ' ';
          }
          text += it.str;
          lastEndX = it.x + it.width;
        }
        return { y: row.y, text: text.trim() };
      })
      .filter((r) => r.text);

    // A row that's just the word-wrapped continuation of the same bullet or
    // paragraph sits one normal "line height" below the row before it; a
    // new bullet, or a section header (e.g. a bare "Requirements" on
    // Sherly's simpler job-ad PDFs, with no bullet marker of its own),
    // follows a distinctly bigger gap — typically about double. Rows that
    // start with an actual bullet/number/letter marker are always treated
    // as a hard break regardless of gap size.
    const gaps = [];
    for (let i = 1; i < rowTexts.length; i++) gaps.push(rowTexts[i - 1].y - rowTexts[i].y);
    const sortedGaps = gaps.filter((g) => g > 0).sort((a, b) => a - b);
    const typicalGap = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 0;

    const pageLines = [];
    for (let i = 0; i < rowTexts.length; i++) {
      const row = rowTexts[i];
      const hasMarker = BULLET_MARKER.test(row.text) || NUMBER_MARKER.test(row.text) || LETTER_MARKER.test(row.text);
      const gap = i > 0 ? rowTexts[i - 1].y - row.y : null;
      const isContinuation = i > 0 && !hasMarker && pageLines.length && typicalGap > 0 && gap <= typicalGap * 1.4;
      if (isContinuation) {
        // A hyphenated word that happens to break right at the line wrap
        // (e.g. "high-" / "performing") should glue back together with no
        // space, same as an ordinary hyphenated compound would within a
        // single line.
        const prev = pageLines[pageLines.length - 1];
        pageLines[pageLines.length - 1] = prev.endsWith('-') ? prev + row.text : prev + ' ' + row.text;
      } else {
        pageLines.push(row.text);
      }
    }
    lines.push(...pageLines);
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
  if (ext === 'docx') {
    return parseDocx(buffer);
  }
  if (ext === 'doc') {
    // The old binary .doc format (pre-2007 Word) isn't something mammoth —
    // or most modern JS libraries — can read; only the newer .docx (OOXML)
    // format is supported. Give a clear next step instead of a confusing
    // crash: Word itself can re-save a .doc as .docx in a couple of clicks.
    throw new Error('Old .doc format is not supported — please re-save the file as .docx in Word (File > Save As > Word Document (.docx)) and upload that instead.');
  }
  throw new Error('Unsupported file format. Please upload a .xlsx, .docx, or .pdf file.');
}

module.exports = { parseJobFile, parseLines, FIELD_DEFS };
