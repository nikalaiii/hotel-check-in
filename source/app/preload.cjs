const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('checkin', {
  choosePdfs: () => invoke('choose-pdfs'),
  importPdfs: files => invoke('import-pdfs', files.map(file => webUtils.getPathForFile(file))),
  catalog: () => invoke('catalog'),
  preview: (records, options) => invoke('preview', records, options),
  printers: () => invoke('printers'),
  savePdf: job => invoke('save-pdf', job),
  print: job => invoke('print-documents', job),
});
