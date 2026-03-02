// Tests for config.ts helpers (getConfigMap, getConfigValue, setConfigValue)

// Load source files (global scope — no exports)
require('../src/types');
require('../src/config');

declare function getConfigMap(): Record<string, string>;
declare function getConfigValue(key: string): string;
declare function setConfigValue(key: string, value: string): void;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const SHEET = 'Config';

describe('getConfigMap', () => {
  it('returns empty map when sheet has only header', () => {
    __seedSheet(SHEET, [['Key', 'Value', 'Description']]);
    expect(getConfigMap()).toEqual({});
  });

  it('parses key-value rows correctly', () => {
    __seedSheet(SHEET, [
      ['Key', 'Value', 'Description'],
      ['Individual_Price', '30', 'Price for individual'],
      ['Family_Price', '50', 'Price for family'],
    ]);
    const map = getConfigMap();
    expect(map['Individual_Price']).toBe('30');
    expect(map['Family_Price']).toBe('50');
  });

  it('skips rows with empty keys', () => {
    __seedSheet(SHEET, [
      ['Key', 'Value', 'Description'],
      ['', '99', 'blank key should be skipped'],
      ['Valid_Key', 'abc', ''],
    ]);
    const map = getConfigMap();
    expect(Object.keys(map)).toHaveLength(1);
    expect(map['Valid_Key']).toBe('abc');
  });
});

describe('getConfigValue', () => {
  it('returns value for existing key', () => {
    __seedSheet(SHEET, [
      ['Key', 'Value', 'Description'],
      ['OTP_Valid_Hours', '24', ''],
    ]);
    expect(getConfigValue('OTP_Valid_Hours')).toBe('24');
  });

  it('returns empty string for missing key', () => {
    __seedSheet(SHEET, [['Key', 'Value', 'Description']]);
    expect(getConfigValue('Nonexistent')).toBe('');
  });
});

describe('setConfigValue', () => {
  it('updates an existing key', () => {
    __seedSheet(SHEET, [
      ['Key', 'Value', 'Description'],
      ['Individual_Price', '30', ''],
    ]);
    setConfigValue('Individual_Price', '35');
    expect(getConfigValue('Individual_Price')).toBe('35');
  });

  it('appends a new key if not found', () => {
    __seedSheet(SHEET, [['Key', 'Value', 'Description']]);
    setConfigValue('New_Key', 'new_value');
    expect(getConfigValue('New_Key')).toBe('new_value');
  });
});
