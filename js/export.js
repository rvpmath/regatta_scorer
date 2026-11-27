// Results as CSV and PDF, and handing files to the iPad's share sheet.

import * as S from './scoring.js';

export function fileSafeName(name) {
  const base = String(name).replace(/[\/\\:?%*|"<>]/g, '-').trim();
  return base || 'Regatta';
}

// ---------- CSV ----------

export function resultsCSV(event) {
  const rows = S.ranking(event);
  const lines = [
    ['Rank', 'Sail number', 'Name', ...event.races.map((_, i) => `R${i + 1}`), 'Total', 'Nett'],
    ...rows.map((row) => [
      String(row.rank),
      row.competitor.sailNumber,
      row.competitor.name,
      ...row.results.map((r) => (r.sailed ? S.resultText(r) : '')),
      String(row.total),
      String(row.nett),
    ]),
  ];
  const field = (v) => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  // The byte-order mark makes Excel read the file as UTF-8.
  return '﻿' + lines.map((l) => l.map(field).join(',')).join('\r\n') + '\r\n';
}

// ---------- PDF ----------
// A small PDF writer using the built-in PDF fonts, so it works offline with
// nothing to download. The table uses Courier so columns line up exactly.

const PAGE_W = 842; // A4 landscape, in points
const PAGE_H = 595;
const MARGIN = 40;

// Characters outside Latin-1 that Windows-1252 (the PDF's encoding) still has.
const WIN_ANSI_EXTRA = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

function pdfText(text) {
  let out = '';
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    let byte;
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) byte = cp;
    else byte = WIN_ANSI_EXTRA[cp] ?? 0x3f; // "?" for anything the font can't show
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += '\\';
    out += String.fromCharCode(byte);
  }
  return '(' + out + ')';
}

function fit(text, width) {
  const chars = [...String(text)];
  return chars.length <= width ? chars.join('') : chars.slice(0, Math.max(width - 1, 1)).join('') + '…';
}

export function resultsPDF(event) {
  const rows = S.ranking(event);
  const raceCount = event.races.length;

  // Column widths in characters.
  const nameWidth = Math.min(22, Math.max(4, ...rows.map((r) => [...r.competitor.name].length)));
  const cols = [
    { title: '#', width: Math.max(2, ...rows.map((r) => String(r.rank).length)), right: true },
    { title: 'Sail no.', width: Math.max(8, ...rows.map((r) => r.competitor.sailNumber.length)) },
    { title: 'Name', width: nameWidth },
  ];
  for (let i = 0; i < raceCount; i++) {
    const texts = rows.map((r) => S.resultText(r.results[i]));
    cols.push({ title: `R${i + 1}`, width: Math.max(3, ...texts.map((t) => t.length)), right: true });
  }
  cols.push({ title: 'Total', width: Math.max(5, ...rows.map((r) => String(r.total).length)), right: true });
  cols.push({ title: 'Nett', width: Math.max(4, ...rows.map((r) => String(r.nett).length)), right: true });

  const gap = 2;
  const totalChars = cols.reduce((sum, c) => sum + c.width, 0) + gap * (cols.length - 1);
  const fontSize = Math.max(5, Math.min(12, (PAGE_W - 2 * MARGIN) / (totalChars * 0.6)));
  const charW = fontSize * 0.6;
  const rowH = fontSize * 1.6;

  const cellTexts = (values) =>
    values.map((v, i) => {
      const t = fit(v, cols[i].width);
      return cols[i].right ? t.padStart(cols[i].width) : t.padEnd(cols[i].width);
    });
  const colX = [];
  let x = MARGIN;
  for (const c of cols) {
    colX.push(x);
    x += (c.width + gap) * charW;
  }
  const tableRight = x - gap * charW;

  const tableTop = PAGE_H - MARGIN - 52;
  const tableBottom = MARGIN + 30;
  const rowsPerPage = Math.max(1, Math.floor((tableTop - tableBottom) / rowH) - 1);
  const pages = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += rowsPerPage) pages.push(rows.slice(i, i + rowsPerPage));

  const date = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const summary = S.scoringSummary(event) + ' Discarded results are in brackets.';

  const streams = pages.map((pageRows, p) => {
    const ops = [];
    const text = (font, size, tx, ty, s, gray = 0) =>
      ops.push(`BT ${gray} g /${font} ${size.toFixed(2)} Tf 1 0 0 1 ${tx.toFixed(2)} ${ty.toFixed(2)} Tm ${pdfText(s)} Tj ET`);
    const line = (y, gray, width) =>
      ops.push(`${gray} G ${width} w ${MARGIN} ${y.toFixed(2)} m ${tableRight.toFixed(2)} ${y.toFixed(2)} l S`);

    text('F1', 18, MARGIN, PAGE_H - MARGIN - 14, event.name);
    text('F4', 10, MARGIN, PAGE_H - MARGIN - 32, `Results, ${date}`, 0.35);

    let y = tableTop;
    cellTexts(cols.map((c) => c.title)).forEach((t, i) => text('F3', fontSize, colX[i], y, t, 0.35));
    line(y - rowH * 0.4, 0.5, 0.8);
    for (const row of pageRows) {
      y -= rowH;
      const values = [
        String(row.rank),
        row.competitor.sailNumber,
        row.competitor.name,
        ...row.results.map((r) => S.resultText(r)),
        String(row.total),
        String(row.nett),
      ];
      cellTexts(values).forEach((t, i) => {
        const r = i >= 3 && i < 3 + raceCount ? row.results[i - 3] : null;
        const muted = (r && (r.discarded || !r.sailed)) || i === cols.length - 2;
        const bold = i === 1 || i === cols.length - 1;
        text(bold ? 'F3' : 'F2', fontSize, colX[i], y, t, muted ? 0.45 : 0);
      });
      line(y - rowH * 0.4, 0.85, 0.5);
    }

    text('F4', 8, MARGIN, MARGIN, summary, 0.35);
    if (pages.length > 1) text('F4', 8, PAGE_W - MARGIN - 60, MARGIN, `Page ${p + 1} of ${pages.length}`, 0.35);
    return ops.join('\n');
  });

  // Assemble the file: catalog, page tree, four fonts, then a page and content stream per page.
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add('');
  const pagesObj = add('');
  const font = (name) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`);
  const f1 = font('Helvetica-Bold');
  const f2 = font('Courier');
  const f3 = font('Courier-Bold');
  const f4 = font('Helvetica');
  const resources = `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R /F4 ${f4} 0 R >> >>`;
  const pageIds = streams.map((stream) => {
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${resources} /Contents ${content} 0 R >>`);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  // Every character above is a single byte (0-255), so this copies it exactly.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

// ---------- Sharing ----------

/** Opens the share sheet with the file (AirDrop, Mail, Print, Save to Files…), or downloads it. */
export async function shareFile(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const file = new File([blob], filename, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // Otherwise fall back to a download below.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}
