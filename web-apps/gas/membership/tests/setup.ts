// ============================================================
// Jest global setup: mock all Google Apps Script APIs
// ============================================================

// In-memory sheet store
const sheetData: Record<string, any[][]> = {};

function makeSheet(name: string) {
  if (!sheetData[name]) sheetData[name] = [[]];
  return {
    getName: () => name,
    getDataRange: () => ({
      getValues: () => sheetData[name].map(r => [...r]),
    }),
    appendRow: (row: any[]) => {
      sheetData[name].push([...row]);
    },
    getRange: (row: number, col: number) => ({
      setValue: (v: any) => {
        while (sheetData[name].length < row) sheetData[name].push([]);
        while (sheetData[name][row - 1].length < col) sheetData[name][row - 1].push('');
        sheetData[name][row - 1][col - 1] = v;
      },
      getValue: () => sheetData[name][row - 1]?.[col - 1] ?? '',
    }),
    deleteRow: (row: number) => {
      sheetData[name].splice(row - 1, 1);
    },
  };
}

// Reset all sheet data between tests
beforeEach(() => {
  Object.keys(sheetData).forEach(k => delete sheetData[k]);
});

// GAS globals — openById works for both spreadsheet IDs; sheets are keyed by name only
(global as any).SpreadsheetApp = {
  openById: (_id: string) => ({
    getSheetByName: (name: string) => makeSheet(name),
  }),
};

(global as any).MailApp = {
  sendEmail: jest.fn(),
};

(global as any).Session = {
  getActiveUser: () => ({ getEmail: () => 'admin@mmrunners.org' }),
};

(global as any).HtmlService = {
  createHtmlOutputFromFile: (file: string) => ({
    setTitle: () => ({}),
    setXFrameOptionsMode: () => ({}),
  }),
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
};

(global as any).Logger = {
  log: jest.fn(),
};

(global as any).ScriptApp = {
  getService: () => ({ getUrl: () => 'https://script.google.com/test' }),
};

// HtmlService.createHtmlOutput needed by ui.ts
(global as any).HtmlService = {
  createHtmlOutputFromFile: (_file: string) => ({
    getContent: () => '<html>__SCRIPT_URL____URL_PARAMS__</html>',
    setTitle: () => ({}),
    setXFrameOptionsMode: () => ({}),
  }),
  createHtmlOutput: (_content: string) => ({
    setTitle: (_t: string) => ({ setXFrameOptionsMode: () => ({}) }),
  }),
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
};

// Expose test helper to seed sheets
(global as any).__seedSheet = (name: string, rows: any[][]) => {
  sheetData[name] = rows.map(r => [...r]);
};

(global as any).__getSheet = (name: string) => sheetData[name] || [];
