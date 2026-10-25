import { emptyReservation, languageFromPhone, validationMessages } from '../src/parser.mjs';

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const state = { records: [], activeId: null, busy: false, catalog: null };
let previewTimer, previewVersion = 0;
function active() { return state.records.find(r => r.id === state.activeId); }
function options() { return { card: $('#option-card').checked, info: $('#option-info').checked, privacy: $('#option-privacy').checked }; }
function notify(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').classList.toggle('hidden', !message);
  $('#notice').classList.toggle('error', error);
}
async function operation(callback) {
  if (state.busy) return;
  state.busy = true; updateButtons();
  try { await callback(); }
  catch (error) { notify(error.message || 'Nie udało się wykonać operacji.', true); }
  finally { state.busy = false; updateButtons(); }
}
function updateButtons() {
  const count = state.records.filter(r => r.selected).length;
  const noDocuments = !Object.values(options()).some(Boolean);
  for (const id of ['save-pdf', 'print']) $(`#${id}`).disabled = state.busy || !count || noDocuments;
  for (const id of ['choose-files', 'add-manual', 'clear-all', 'select-all', 'option-card', 'option-info', 'option-privacy', 'printer']) $(`#${id}`).disabled = state.busy;
  $('#guest-form').inert = state.busy;
  $('#record-list').inert = state.busy;
  $('#selection-count').textContent = state.busy ? 'Przetwarzanie…' : `Wybrane rezerwacje: ${count} / ${state.records.length}`;
  $('#select-all').checked = Boolean(state.records.length) && count === state.records.length;
  $('#select-all').indeterminate = count > 0 && count < state.records.length;
}
function list() {
  $('#record-count').textContent = state.records.length;
  $('#empty-list').classList.toggle('hidden', state.records.length > 0);
  $('#record-list').classList.toggle('hidden', state.records.length === 0);
  $('#record-list').innerHTML = state.records.map(r => {
    const warningCount = validationMessages(r).length;
    return `<div class="record-row ${r.id === state.activeId ? 'active' : ''}" data-id="${r.id}" tabindex="0" role="button" aria-label="Edytuj ${escapeHtml(r.name || 'pusty wpis')}"><input type="checkbox" aria-label="Wybierz ${escapeHtml(r.name || 'wpis')}" ${r.selected ? 'checked' : ''}><div class="record-content"><div class="record-name">${escapeHtml(r.name || 'Nie podano nazwiska')}</div><div class="record-dates">${escapeHtml(r.arrival || '—')} → ${escapeHtml(r.departure || '—')}</div><div class="record-tags"><span class="tag">${r.language.toUpperCase()}</span>${r.room ? `<span class="tag">Pokój ${escapeHtml(r.room)}</span>` : ''}${warningCount ? `<span class="tag warning">Sprawdź · ${warningCount}</span>` : '<span class="tag">Dane podstawowe ✓</span>'}</div></div><button class="remove-record" title="Usuń wpis" aria-label="Usuń wpis">×</button></div>`;
  }).join('');
  updateButtons();
}
function warnings() {
  const record = active();
  if (!record) return;
  const items = validationMessages(record);
  $('#warnings').innerHTML = items.length ? `<ul>${items.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '';
  for (const key of ['name', 'arrival', 'departure', 'guestCount']) $('#guest-form').elements[key].classList.toggle('missing', !record[key]);
}
function languageHints() {
  const r = active(); if (!r) return;
  const form = $('#guest-form');
  form.elements.language.disabled = r.languageMode === 'auto';
  $('#language-hint').textContent = r.languageMode === 'auto' ? `Wybrano ${r.language.toUpperCase()} na podstawie telefonu. Bez rozpoznanego kodu kraju używany jest polski.` : 'Ręczny wybór języka jest zachowany także po zmianie numeru telefonu.';
  const variants = state.catalog?.info[r.language] || [];
  for (const option of form.elements.infoVariant.options) option.disabled = !variants.includes(option.value);
  const missing = [];
  if (!variants.includes(r.infoVariant)) missing.push('Brak tego wariantu informacji dla gościa.');
  if (!state.catalog?.privacy.includes(r.language)) missing.push('Brak pełnej klauzuli danych osobowych w tym języku.');
  if (r.language === 'cze' && r.infoVariant === 'no-restaurant') missing.push('Uwaga: źródłowy czeski szablon „bez restauracji” nadal opisuje restaurację. Sprawdź treść przed wydrukiem.');
  $('#template-hint').textContent = missing.join(' ');
  $('#template-hint').classList.toggle('warning', missing.length > 0);
}
function editor() {
  const r = active();
  $('#guest-form').classList.toggle('hidden', !r);
  $('#editor-empty').classList.toggle('hidden', Boolean(r));
  if (!r) { schedulePreview(); return; }
  const form = $('#guest-form');
  for (const element of form.elements) if (element.name && element.name in r) element.value = r[element.name];
  $('#source-label').textContent = `${r.sourceName || 'Wpis ręczny'}${r.reservationNumber ? ` · nr ${r.reservationNumber}` : ''}`;
  $('#raw-text').textContent = r.rawText || 'Wpis ręczny — brak pliku źródłowego.';
  warnings(); languageHints(); schedulePreview();
}
function fitPreview() {
  const frame = $('#preview-frame');
  const doc = frame.contentDocument;
  if (!doc?.body) return;
  // CSS zoom preserves the same A4 geometry and makes it readable in a narrow pane.
  doc.body.style.zoom = String(Math.max(0.15, (frame.clientWidth - 22) / (595.276 * 96 / 72)));
  doc.body.style.background = '#e8ece3';
}
function schedulePreview() {
  clearTimeout(previewTimer);
  previewVersion++;
  const version = previewVersion;
  previewTimer = setTimeout(async () => {
    const r = active();
    if (!r || !Object.values(options()).some(Boolean)) {
      $('#preview-frame').classList.add('hidden'); $('#preview-empty').classList.remove('hidden'); $('#page-count').textContent = '—';
      return;
    }
    try {
      const result = await window.checkin.preview([r], options());
      if (version !== previewVersion) return;
      $('#preview-frame').srcdoc = result.html;
      $('#preview-frame').classList.toggle('hidden', result.pageCount === 0);
      $('#preview-empty').classList.toggle('hidden', result.pageCount !== 0);
      $('#page-count').textContent = `${result.pageCount} str. A4`;
    } catch (error) { if (version === previewVersion) notify(error.message, true); }
  }, 180);
}
function acceptResults(results) {
  let imported = 0, duplicate = 0;
  const failures = [];
  for (const result of results) {
    if (!result.ok) { failures.push(`${result.sourceName}: ${result.error}`); continue; }
    if (state.records.some(r => r.id === result.record.id)) { duplicate++; continue; }
    if (state.records.length >= 100) { failures.push('Limit sesji wynosi 100 rezerwacji.'); break; }
    state.records.push(result.record); imported++;
    state.activeId = result.record.id;
  }
  list(); editor();
  notify([`Dodano rezerwacje: ${imported}.`, duplicate ? `Pominięto identyczne pliki: ${duplicate}.` : '', ...failures].filter(Boolean).join('\n'), failures.length > 0);
}
$('#choose-files').addEventListener('click', event => { event.stopPropagation(); operation(async () => acceptResults(await window.checkin.choosePdfs())); });
$('#drop-zone').addEventListener('click', () => { if (!state.busy) $('#choose-files').click(); });
$('#drop-zone').addEventListener('keydown', event => { if (event.target === $('#drop-zone') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); $('#choose-files').click(); } });
for (const type of ['dragenter', 'dragover']) $('#drop-zone').addEventListener(type, event => { event.preventDefault(); if (!state.busy) $('#drop-zone').classList.add('dragging'); });
$('#drop-zone').addEventListener('dragleave', event => { if (!$('#drop-zone').contains(event.relatedTarget)) $('#drop-zone').classList.remove('dragging'); });
$('#drop-zone').addEventListener('drop', event => {
  event.preventDefault(); $('#drop-zone').classList.remove('dragging');
  const files = Array.from(event.dataTransfer.files);
  if (files.length) operation(async () => acceptResults(await window.checkin.importPdfs(files)));
});
// Never navigate Electron to a PDF dropped outside the target.
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
$('#record-list').addEventListener('click', event => {
  const row = event.target.closest('.record-row'); if (!row) return;
  const r = state.records.find(record => record.id === row.dataset.id);
  if (event.target.matches('input')) { r.selected = event.target.checked; updateButtons(); return; }
  if (event.target.closest('.remove-record')) {
    state.records = state.records.filter(record => record.id !== r.id);
    if (state.activeId === r.id) state.activeId = state.records[0]?.id || null;
  } else state.activeId = r.id;
  list(); editor();
});
$('#record-list').addEventListener('keydown', event => { if (event.target.matches('.record-row') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.click(); } });
$('#select-all').addEventListener('change', event => { for (const r of state.records) r.selected = event.target.checked; list(); });
$('#clear-all').addEventListener('click', () => {
  if (!state.records.length || !window.confirm('Usunąć wszystkie wpisy z bieżącej sesji?')) return;
  state.records = []; state.activeId = null; list(); editor(); notify('');
});
$('#add-manual').addEventListener('click', () => {
  if (state.records.length >= 100) { notify('Limit sesji wynosi 100 rezerwacji.', true); return; }
  const r = { ...emptyReservation(), id: crypto.randomUUID(), sourceName: 'Wpis ręczny', selected: true, language: 'pl', languageMode: 'auto', infoVariant: 'standard', warnings: [] };
  state.records.push(r); state.activeId = r.id; list(); editor(); $('#guest-form').elements.name.focus();
});
$('#guest-form').addEventListener('submit', event => event.preventDefault());
$('#guest-form').addEventListener('input', event => {
  const r = active(); if (!r || !event.target.name) return;
  r[event.target.name] = event.target.value;
  if (['phone', 'languageMode'].includes(event.target.name) && r.languageMode === 'auto') {
    r.language = languageFromPhone(r.phone);
    $('#guest-form').elements.language.value = r.language;
  }
  const variants = state.catalog?.info[r.language] || [];
  if (variants.length && !variants.includes(r.infoVariant)) { r.infoVariant = variants[0]; $('#guest-form').elements.infoVariant.value = r.infoVariant; }
  warnings(); languageHints(); list(); schedulePreview();
});
for (const id of ['option-card', 'option-info', 'option-privacy']) $(`#${id}`).addEventListener('change', () => { updateButtons(); schedulePreview(); });
$('#refresh-preview').addEventListener('click', schedulePreview);
$('#preview-frame').addEventListener('load', fitPreview);
new ResizeObserver(fitPreview).observe($('.preview-area'));

function output(action) {
  return operation(async () => {
    const records = state.records.filter(r => r.selected);
    const badDates = records.some(r => r.arrival && r.departure && r.departure <= r.arrival);
    if (badDates) { notify('Popraw daty: wyjazd musi być późniejszy od przyjazdu.', true); return; }
    if (records.some(r => r.guestCount && (!/^\d+$/.test(r.guestCount) || +r.guestCount < 1))) { notify('Popraw liczbę gości: wymagana jest dodatnia liczba całkowita.', true); return; }
    if (records.some(r => r.price && (!Number.isFinite(Number(r.price)) || +r.price < 0))) { notify('Popraw cenę pobytu.', true); return; }
    if (options().info && records.some(r => r.language === 'cze' && r.infoVariant === 'no-restaurant')) {
      if (!window.confirm('Czeski szablon „bez restauracji” nadal zawiera informację o restauracji. Kontynuować z tą treścią?')) return;
    }
    const result = await window.checkin[action]({ records, options: options(), deviceName: $('#printer').value });
    if (!result.canceled) notify(action === 'savePdf' ? `Zapisano ${result.pageCount} stron: ${result.fileName}` : `Wysłano zadanie do systemu drukowania: ${result.pageCount} stron. Stan fizycznego wydruku sprawdź na drukarce.`);
  });
}
$('#save-pdf').addEventListener('click', () => output('savePdf'));
$('#print').addEventListener('click', () => output('print'));
$('#help').addEventListener('click', () => $('#help-dialog').showModal());
window.addEventListener('beforeunload', event => { if (state.busy) { event.preventDefault(); event.returnValue = ''; } });

try {
  state.catalog = await window.checkin.catalog();
  const printers = await window.checkin.printers();
  for (const p of printers) { const option = document.createElement('option'); option.value = p.name; option.textContent = p.displayName || p.name; $('#printer').append(option); }
} catch (error) { notify(`Nie udało się odczytać ustawień: ${error.message}`, true); }
list(); editor();
