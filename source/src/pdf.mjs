import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseReservation } from './parser.mjs';

export function textFromItems(items) {
  // Group by baseline, then restore left-to-right order. PDF stream order often
  // places every label before every value, even when they share a printed row.
  const lines = [];
  for (const item of items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const y = item.transform[5];
    let line = lines.find(row => Math.abs(row.y - y) < 2.2);
    if (!line) { line = { y, items: [] }; lines.push(line); }
    line.items.push(item);
  }
  return lines.sort((a, b) => b.y - a.y).map(line => {
    const sorted = line.items.sort((a, b) => a.transform[4] - b.transform[4]);
    return sorted.reduce((text, item, index) => {
      const previous = sorted[index - 1];
      const gap = previous ? item.transform[4] - previous.transform[4] - previous.width : 0;
      return text + (previous && gap > 0.8 && !/\s$/.test(text) && !/^\s/.test(item.str) ? ' ' : '') + item.str;
    }, '');
  }).join('\n');
}

export async function extractPdf(buffer) {
  const canvas = await import('@napi-rs/canvas');

  globalThis.DOMMatrix ??= canvas.DOMMatrix;
  globalThis.ImageData ??= canvas.ImageData;
  globalThis.Path2D ??= canvas.Path2D;

  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const packageRoot = new URL('../node_modules/pdfjs-dist/', import.meta.url);
  const task = getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true,
    standardFontDataUrl: fileURLToPath(new URL('standard_fonts/', packageRoot)) + '/',
    cMapUrl: fileURLToPath(new URL('cmaps/', packageRoot)) + '/', cMapPacked: true,
  });
  let pdf;
  try {
    pdf = await task.promise;
    if (pdf.numPages > 30) throw new Error('PDF ma ponad 30 stron. Podziel go na mniejsze pliki.');
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      pages.push(textFromItems((await page.getTextContent()).items));
    }
    return pages.join('\n\n');
  } finally { await task.destroy(); }
}

export async function parsePdfFile(path) {
  const data = await readFile(path);
  if (data.length > 25 * 1024 * 1024) throw new Error('Plik przekracza limit 25 MB.');
  if (!data.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Plik nie jest poprawnym PDF.');
  const { basename } = await import('node:path');
  return { record: parseReservation(await extractPdf(data), basename(path)), data };
}
