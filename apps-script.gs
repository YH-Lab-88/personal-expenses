const SHEET_ID = '1Dcog-g4Epq5qprE3iHC7p_QFOYLKdbMC2Lh2fs3IFEo';
const EXPENSES_SHEET_NAME = 'My Expenses';
const OPTIONS_SHEET_NAME = '选项';

function getExpensesSheet() {
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  return spreadsheet.getSheetByName(EXPENSES_SHEET_NAME) || spreadsheet.getSheets()[0];
}

function getLastRecordRow(sheet) {
  const values = sheet.getRange(1, 1, sheet.getMaxRows(), 4).getValues();
  for (let index = values.length - 1; index >= 1; index -= 1) {
    if (values[index].some((value) => value !== '' && value !== null)) return index + 1;
  }
  return 1;
}

function formatDate(value) {
  return value instanceof Date
    ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd')
    : String(value || '');
}

function getTopics() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(OPTIONS_SHEET_NAME);
  if (!sheet) return [];
  return sheet.getDataRange().getValues().flat().map(String).map((value) => value.trim()).filter((value) => value && value !== 'Topic' && value !== '选项');
}

function doGet(e) {
  const sheet = getExpensesSheet();
  if (!sheet) throw new Error('Expenses sheet not found');
  const lastRow = getLastRecordRow(sheet);
  const records = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 4).getValues().map((values, index) => ({
    row: index + 2,
    date: formatDate(values[0]),
    topic: values[1],
    others: values[2],
    cost: Number(values[3]) || 0,
  })).filter((record) => record.date && record.topic && record.cost >= 0).reverse() : [];
  const payload = JSON.stringify({ ok: true, records, topics: getTopics() });
  const callback = e && e.parameter && e.parameter.callback;
  if (callback && /^[A-Za-z_$][\w$]*$/.test(callback)) {
    return ContentService.createTextOutput(`${callback}(${payload})`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
  const data = JSON.parse(e.postData.contents || '{}');
  const sheet = getExpensesSheet();
  if (!sheet) throw new Error('Expenses sheet not found');
  const lastRow = getLastRecordRow(sheet);
  if (data.action === 'delete') {
    const row = Number(data.row);
    if (!Number.isInteger(row) || row < 2 || row > lastRow) throw new Error('Invalid row');
    if (row < lastRow) sheet.getRange(row + 1, 1, lastRow - row, 4).copyTo(sheet.getRange(row, 1, lastRow - row, 4));
    sheet.getRange(lastRow, 1, 1, 4).clearContent();
    SpreadsheetApp.flush();
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  }
  if (!data.date || !data.topic || !Number(data.cost) || Number(data.cost) < 0) throw new Error('Missing required fields');
  const newRow = lastRow + 1;
  sheet.getRange(newRow, 1, 1, 4).setValues([[new Date(data.date), data.topic, data.others || '', Number(data.cost)]]);
  sheet.getRange(newRow, 1).setNumberFormat('dd/MM/yyyy');
  SpreadsheetApp.flush();
  return ContentService.createTextOutput(JSON.stringify({ ok: true, row: newRow })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
