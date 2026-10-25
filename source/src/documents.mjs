import { readFileSync } from 'node:fs';
import { fields, languageFromPhone } from './parser.mjs';

const catalog = JSON.parse(readFileSync(new URL('../templates/catalog.json', import.meta.url), 'utf8'));
const backgrounds = Object.fromEntries(Object.entries(catalog.cards).map(([lang, item]) => [lang, readFileSync(new URL(`../templates/${item.file}`, import.meta.url), 'utf8')]));
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
export const displayDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('.') : value;

export function sanitizeRecord(input) {
  const r = Object.fromEntries(fields.map(key => [key, typeof input?.[key] === 'string' ? input[key].slice(0, 160) : '']));
  r.language = ['pl', 'cze', 'deu', 'eng'].includes(input?.language) ? input.language : languageFromPhone(r.phone);
  r.infoVariant = ['standard', 'no-dinner', 'no-restaurant'].includes(input?.infoVariant) ? input.infoVariant : 'standard';
  return r;
}

export function templateAvailability(record) {
  return { card: true, info: Boolean(catalog.info[record.language]?.[record.infoVariant || 'standard']), privacy: Boolean(catalog.privacy[record.language]) };
}

function cardPage(r) {
  const template = catalog.cards[r.language];
  const overlay = template.fields.map(f => {
    let value = r[f.field];
    if (['arrival', 'departure'].includes(f.field)) value = displayDate(value);
    if (f.field === 'price' && value && Number.isFinite(Number(value))) value = Number(value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN';
    if (!value) return '';
    const fontSize = f.kind === 'cell' ? (value.length > 65 ? 8 : 11) : Math.max(7, Math.min(10, f.width / (value.length * 0.56)));
    return `<div class="field ${f.kind}" style="left:${f.x}pt;top:${f.y}pt;width:${f.width}pt;height:${f.height}pt;font-size:${fontSize}pt">${escapeHtml(value)}</div>`;
  }).join('');
  return `<section class="page card" aria-label="Karta gościa">${backgrounds[r.language]}${overlay}</section>`;
}

const floorNames = {
  pl: { '0': 'Parter', '1': 'I piętro', '2': 'II piętro' },
  cze: { '0': 'Přízemí', '1': 'I. patro', '2': 'II. patro' },
  deu: { '0': 'Erdgeschoss', '1': 'I. Stock', '2': 'II. Stock' },
  eng: { '0': 'Ground floor', '1': '1st floor', '2': '2nd floor' },
};
const floorLabels = { pl: 'Piętro', cze: 'Patro', deu: 'Stockwerk', eng: 'Floor' };
const metaLabels = {
  pl: ['Pokój', 'Przyjazd', 'Wyjazd'], cze: ['Pokoj', 'Příjezd', 'Odjezd'],
  deu: ['Zimmer', 'Anreise', 'Abreise'], eng: ['Room', 'Arrival', 'Departure'],
};
function infoPage(r) {
  const template = catalog.info[r.language]?.[r.infoVariant];
  if (!template) return null;
  // These paragraphs belong to positioned source text boxes and are already
  // represented by the service descriptions. Avoid orphaned floor labels.
  const paragraphs = template.paragraphs.filter(p => !/^(?:POZIOM|ÚROVEŇ|GESCHOSS)\s*:/i.test(p) && !/^_+$/.test(p));
  const title = paragraphs.shift();
  const body = paragraphs.filter(p => !/Twój pokój znajduje|Váš pokoj se nachází|Zimmer befindet sich/i.test(p));
  const labels = metaLabels[r.language];
  return `<section class="page text-page info"><div class="hotel-label">WILLA ODKRYWCÓW · HOTEL★★★</div><h1>${escapeHtml(title)}</h1><div class="guest-meta"><strong>${escapeHtml(r.name)}</strong><span>${labels[0]}: ${escapeHtml(r.room)}</span><span>${labels[1]}: ${escapeHtml(displayDate(r.arrival))} &nbsp; ${labels[2]}: ${escapeHtml(displayDate(r.departure))}</span><span>${floorLabels[r.language]}: ${escapeHtml(floorNames[r.language][r.floor] || '')}</span></div><div class="info-content">${body.map(p => `<p>${escapeHtml(p)}</p>`).join('')}</div></section>`;
}
function privacyPage(r) {
  const template = catalog.privacy[r.language];
  if (!template) return null;
  const [title, ...body] = template.paragraphs;
  return `<section class="page text-page privacy"><div class="hotel-label">WILLA ODKRYWCÓW · HOTEL★★★</div><h1>${escapeHtml(title)}</h1><div class="privacy-content">${body.map(p => `<p>${escapeHtml(p)}</p>`).join('')}</div></section>`;
}

export function buildDocument(records, options = {}) {
  if (!Array.isArray(records) || records.length > 100) throw new Error('Wybierz od 1 do 100 rezerwacji.');
  const pages = [];
  const skipped = [];
  for (const input of records) {
    const record = sanitizeRecord(input);
    if (options.card !== false) pages.push(cardPage(record));
    for (const [key, build] of [['info', infoPage], ['privacy', privacyPage]]) {
      if (!options[key]) continue;
      const page = build(record);
      if (page) pages.push(page);
      else skipped.push(`${record.name || 'Gość'}: brak szablonu ${key === 'info' ? 'informacji' : 'danych osobowych'} (${record.language.toUpperCase()}).`);
    }
  }
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><title>Dokumenty meldunkowe</title><style>
    @page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#e8eae7;font-family:Arial,Helvetica,sans-serif;color:#111}.page{position:relative;width:595.276pt;height:841.89pt;margin:14pt auto;background:white;break-after:page;page-break-after:always;overflow:hidden;box-shadow:0 2pt 12pt #0001}.page:last-child{break-after:auto;page-break-after:auto}.card>svg{position:absolute;inset:0;width:100%;height:100%}.field{position:absolute;display:flex;align-items:center;line-height:1.12;overflow:hidden;overflow-wrap:anywhere;white-space:normal;color:#111}.field.line{background:white;white-space:nowrap}.text-page{padding:37pt 39pt}.hotel-label{font-size:8pt;letter-spacing:1.8pt;color:#555;margin-bottom:15pt}h1{font-size:18pt;line-height:1.2;margin:0 0 18pt;color:#111}.guest-meta{border:1pt solid #ccc;padding:12pt;margin-bottom:17pt;display:flex;flex-wrap:wrap;gap:8pt 14pt;font-size:10pt}.guest-meta strong{width:100%;font-size:13pt}.info-content{font-size:11pt;line-height:1.35}.info-content p{margin:0 0 10pt;white-space:pre-wrap}.privacy h1{font-size:15pt;margin-bottom:14pt}.privacy-content{font-size:8.5pt;line-height:1.22;column-count:2;column-gap:20pt}.privacy-content p{margin:0 0 7pt;break-inside:avoid;overflow-wrap:anywhere}
    @media print{html,body{background:white}.page{margin:0;box-shadow:none}}
  </style></head><body>${pages.join('')}</body></html>`;
  return { html, pageCount: pages.length, skipped };
}

export function publicCatalog() { return { info: Object.fromEntries(Object.entries(catalog.info).map(([lang, variants]) => [lang, Object.keys(variants)])), privacy: Object.keys(catalog.privacy), notes: catalog.notes }; }
