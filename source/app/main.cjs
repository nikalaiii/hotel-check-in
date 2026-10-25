const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

let mainWindow;
let parser, documents;
let outputBusy = false;

function harden(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Willa Check-in', width: 1460, height: 960, minWidth: 1080, minHeight: 720,
    backgroundColor: '#f4f5f0', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  harden(mainWindow);
  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function assertMainSender(event) {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Niedozwolony nadawca.');
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertMainSender(event);
    try { return { ok: true, value: await callback(...args) }; }
    catch (error) { return { ok: false, error: error.message || 'Nie udało się wykonać operacji.' }; }
  });
}
async function importFiles(paths) {
  if (!Array.isArray(paths) || paths.length > 100) throw new Error('Jednorazowo dodaj maksymalnie 100 plików.');
  const results = [];
  for (const file of paths) {
    const sourceName = typeof file === 'string' ? path.basename(file) : 'Plik';
    try {
      if (typeof file !== 'string' || !path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.pdf') throw new Error('Obsługiwane są wyłącznie pliki PDF.');
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error('Nieprawidłowy plik lub rozmiar powyżej 25 MB.');
      const { record, data } = await parser.parsePdfFile(file);
      results.push({ ok: true, record: { ...record, id: crypto.createHash('sha256').update(data).digest('hex'), infoVariant: 'standard', selected: true } });
    } catch (error) {
      results.push({ ok: false, sourceName, error: error.name === 'PasswordException' ? 'PDF jest zabezpieczony hasłem. Zapisz niezabezpieczoną kopię.' : error.message });
    }
  }
  return results;
}

async function renderJob(job, action) {
  if (outputBusy) throw new Error('Poprzednie zadanie jeszcze trwa. Poczekaj na jego zakończenie.');
  outputBusy = true;
  let win, directory;
  try {
    if (!job || !Array.isArray(job.records) || !job.records.length) throw new Error('Wybierz przynajmniej jedną rezerwację.');
    const document = documents.buildDocument(job.records, job.options);
    if (!document.pageCount) throw new Error('Nie wybrano żadnego dostępnego dokumentu.');
    if (document.skipped.length) {
      const result = await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Niepełny zestaw dokumentów', message: 'Niektóre szablony nie są dostępne.', detail: document.skipped.join('\n'), buttons: ['Anuluj', 'Kontynuuj z dostępnymi dokumentami'], defaultId: 0, cancelId: 0 });
      if (result.response === 0) return { canceled: true };
    }
    let target;
    if (action === 'save') {
      const result = await dialog.showSaveDialog(mainWindow, { title: 'Zapisz dokumenty', defaultPath: `Dokumenty-meldunkowe-${new Date().toLocaleDateString('sv-SE')}.pdf`, filters: [{ name: 'Dokument PDF', extensions: ['pdf'] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      target = result.filePath;
    }
    directory = await fs.mkdtemp(path.join(app.getPath('temp'), 'willa-checkin-'));
    const file = path.join(directory, 'documents.html');
    await fs.writeFile(file, document.html, { encoding: 'utf8', mode: 0o600 });
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } });
    harden(win);
    await win.loadURL(pathToFileURL(file).href);
    // Load is complete before export. No external assets or fonts are requested.
    if (action === 'save') {
      const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      await fs.writeFile(target, pdf);
      return { pageCount: document.pageCount, fileName: path.basename(target) };
    }
    const device = typeof job.deviceName === 'string' ? job.deviceName : '';
    if (device) {
      const printers = await mainWindow.webContents.getPrintersAsync();
      if (!printers.some(p => p.name === device)) throw new Error('Wybrana drukarka nie jest już dostępna.');
    }
    await new Promise((resolve, reject) => win.webContents.print({ silent: false, deviceName: device, printBackground: true, pageSize: 'A4', margins: { marginType: 'none' } }, (success, reason) => success ? resolve() : reject(new Error(reason === 'cancelled' || /cancel/i.test(reason) ? 'Drukowanie anulowano.' : `Nie udało się wysłać zadania do drukarki: ${reason}`))));
    return { pageCount: document.pageCount };
  } finally {
    win?.destroy();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    outputBusy = false;
  }
}

app.whenReady().then(async () => {
  [parser, documents] = await Promise.all([import('../src/pdf.mjs'), import('../src/documents.mjs')]);
  handle('choose-pdfs', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Dodaj potwierdzenia rezerwacji', filters: [{ name: 'Potwierdzenia PDF', extensions: ['pdf'] }], properties: ['openFile', 'multiSelections'] });
    return result.canceled ? [] : importFiles(result.filePaths);
  });
  handle('import-pdfs', importFiles);
  handle('catalog', () => documents.publicCatalog());
  handle('preview', (records, options) => documents.buildDocument(records, options));
  handle('printers', () => mainWindow.webContents.getPrintersAsync());
  handle('save-pdf', job => renderJob(job, 'save'));
  handle('print-documents', job => renderJob(job, 'print'));
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => { dialog.showErrorBox('Willa Check-in', error.message); app.quit(); });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
