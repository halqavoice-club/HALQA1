'use strict';
/**
 * Phase 2A — xlsx → exceljs migration tests
 *
 * Tests the excel.js utility and verifies import.controller.js behavior
 * is preserved after the migration from xlsx@0.18.5 to exceljs@4.4.0.
 *
 * Coverage:
 *  A. Valid workbook with expected columns
 *  B. Multiple worksheets (only first sheet used)
 *  C. Empty worksheet
 *  D. Empty rows (skipped)
 *  E. Missing required columns
 *  F. Duplicate records detected (checked at controller level)
 *  G. Invalid values (email format)
 *  H. Large-but-within-limit workbook (1000 rows)
 *  I. Corrupted/non-xlsx buffer
 *  J. Unsupported file (empty buffer)
 *  K. Row limit enforcement (>1000 rows)
 *  L. buildWorkbook produces valid xlsx buffer
 *  M. buildMultiSheetWorkbook produces valid xlsx with multiple sheets
 *  N. Formula cells — value extracted, formula string not stored
 *  O. No xlsx package in production dependency tree
 */

const ExcelJS = require('exceljs');
const { parseWorkbookBuffer, buildWorkbook, buildMultiSheetWorkbook } = require('../utils/excel');

// ─── Helper: create an in-memory xlsx buffer ──────────────────────────────────

async function makeWorkbook(sheets) {
  const wb = new ExcelJS.Workbook();
  for (const { name, rows } of sheets) {
    const ws = wb.addWorksheet(name);
    if (rows.length > 0) {
      ws.columns = Object.keys(rows[0]).map(k => ({ header: k, key: k }));
      rows.forEach(r => ws.addRow(r));
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── A. Valid workbook ────────────────────────────────────────────────────────
describe('A. parseWorkbookBuffer — valid workbook', () => {
  test('parses rows into plain objects with correct field names', async () => {
    const buf = await makeWorkbook([{
      name: 'Sheet1',
      rows: [
        { firstName: 'Ahmad', lastName: 'Hassan', email: 'ahmad@school.com', studentId: 'STU-001' },
        { firstName: 'Fatima', lastName: 'Ali', email: 'fatima@school.com', studentId: 'STU-002' }
      ]
    }]);
    const rows = await parseWorkbookBuffer(buf);
    expect(rows).toHaveLength(2);
    expect(rows[0].firstName).toBe('Ahmad');
    expect(rows[0].email).toBe('ahmad@school.com');
    expect(rows[1].studentId).toBe('STU-002');
  });

  test('trims whitespace from header names', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['  firstName  ', '  email  ']);
    ws.addRow(['Ahmad', 'ahmad@school.com']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await parseWorkbookBuffer(buf);
    expect(rows[0]).toHaveProperty('firstName');
    expect(rows[0]).toHaveProperty('email');
  });
});

// ─── B. Multiple worksheets ───────────────────────────────────────────────────
describe('B. parseWorkbookBuffer — multiple worksheets', () => {
  test('uses only the first worksheet', async () => {
    const buf = await makeWorkbook([
      { name: 'Students', rows: [{ name: 'Ahmad', email: 'a@s.com' }] },
      { name: 'Teachers', rows: [{ name: 'Ustaaz', email: 'u@s.com' }] }
    ]);
    const rows = await parseWorkbookBuffer(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Ahmad');
  });
});

// ─── C. Empty worksheet ───────────────────────────────────────────────────────
describe('C. parseWorkbookBuffer — empty worksheet', () => {
  test('returns empty array for worksheet with only a header row', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['firstName', 'email']); // header only
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await parseWorkbookBuffer(buf);
    expect(rows).toHaveLength(0);
  });

  test('returns empty array for completely empty worksheet', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Empty');
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await parseWorkbookBuffer(buf);
    expect(rows).toHaveLength(0);
  });
});

// ─── D. Empty rows skipped ────────────────────────────────────────────────────
describe('D. parseWorkbookBuffer — empty rows skipped', () => {
  test('skips rows where all cells are empty', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['firstName', 'email']);
    ws.addRow(['Ahmad', 'ahmad@school.com']);
    ws.addRow(['', '']); // empty row
    ws.addRow(['Fatima', 'fatima@school.com']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await parseWorkbookBuffer(buf);
    expect(rows).toHaveLength(2);
    expect(rows[1].firstName).toBe('Fatima');
  });
});

// ─── E. Missing required columns ─────────────────────────────────────────────
describe('E. parseWorkbookBuffer — missing columns', () => {
  test('returns rows missing required fields (validation is controller responsibility)', async () => {
    const buf = await makeWorkbook([{
      name: 'Sheet1',
      rows: [{ firstName: 'Ahmad' }] // missing email, studentId, lastName
    }]);
    const rows = await parseWorkbookBuffer(buf);
    // Parser returns the row — it has what it has
    expect(rows).toHaveLength(1);
    expect(rows[0].firstName).toBe('Ahmad');
    expect(rows[0].email).toBeUndefined();
  });
});

// ─── G. Invalid email values ──────────────────────────────────────────────────
describe('G. parseWorkbookBuffer — invalid values preserved for controller validation', () => {
  test('returns rows with invalid email as-is (controller validates)', async () => {
    const buf = await makeWorkbook([{
      name: 'Sheet1',
      rows: [{ firstName: 'Ahmad', email: 'not-an-email', studentId: 'STU-001', lastName: 'Hassan' }]
    }]);
    const rows = await parseWorkbookBuffer(buf);
    expect(rows[0].email).toBe('not-an-email');
  });
});

// ─── H. Large workbook within limit ──────────────────────────────────────────
describe('H. parseWorkbookBuffer — large workbook within 1000-row limit', () => {
  test('parses 1000 data rows without error', async () => {
    const dataRows = Array.from({ length: 1000 }, (_, i) => ({
      firstName: `Student${i}`,
      lastName: 'Test',
      email: `student${i}@school.com`,
      studentId: `STU-${String(i).padStart(4, '0')}`
    }));
    const buf = await makeWorkbook([{ name: 'Sheet1', rows: dataRows }]);
    const rows = await parseWorkbookBuffer(buf);
    expect(rows).toHaveLength(1000);
  });
});

// ─── I. Corrupted/non-xlsx buffer ────────────────────────────────────────────
describe('I. parseWorkbookBuffer — corrupted file', () => {
  test('throws safe error message for random bytes', async () => {
    const junk = Buffer.from('this is not an excel file at all !!!');
    await expect(parseWorkbookBuffer(junk)).rejects.toThrow(
      'Invalid or corrupted Excel file. Please upload a valid .xlsx file.'
    );
  });

  test('throws safe error message for a PDF-like buffer', async () => {
    const pdfHeader = Buffer.from('%PDF-1.4 fake pdf content');
    await expect(parseWorkbookBuffer(pdfHeader)).rejects.toThrow(
      'Invalid or corrupted Excel file. Please upload a valid .xlsx file.'
    );
  });

  test('error message does not leak internal parser details', async () => {
    const junk = Buffer.from('garbage');
    try {
      await parseWorkbookBuffer(junk);
    } catch (err) {
      // Error must be a safe generic message, not an ExcelJS stack trace
      expect(err.message).not.toMatch(/ExcelJS|Cannot read|TypeError|stack/i);
      expect(err.message).toMatch(/Invalid or corrupted/);
    }
  });
});

// ─── J. Empty buffer ──────────────────────────────────────────────────────────
describe('J. parseWorkbookBuffer — empty buffer', () => {
  test('throws safe error for empty buffer', async () => {
    await expect(parseWorkbookBuffer(Buffer.alloc(0))).rejects.toThrow(
      'Invalid or corrupted Excel file. Please upload a valid .xlsx file.'
    );
  });
});

// ─── K. Row limit enforcement ─────────────────────────────────────────────────
describe('K. parseWorkbookBuffer — row limit', () => {
  test('stops at MAX_PARSE_ROWS (1100) even if workbook has more', async () => {
    // Build 1200 rows
    const dataRows = Array.from({ length: 1200 }, (_, i) => ({
      email: `s${i}@school.com`, firstName: 'A', lastName: 'B', studentId: `S${i}`
    }));
    const buf = await makeWorkbook([{ name: 'Sheet1', rows: dataRows }]);
    const rows = await parseWorkbookBuffer(buf);
    // MAX_PARSE_ROWS = 1100, so we get at most 1100
    expect(rows.length).toBeLessThanOrEqual(1100);
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ─── L. buildWorkbook ─────────────────────────────────────────────────────────
describe('L. buildWorkbook — produces valid xlsx buffer', () => {
  test('returns a Buffer', async () => {
    const buf = await buildWorkbook([{ Name: 'Ahmad', Email: 'a@s.com' }], 'Students');
    expect(Buffer.isBuffer(buf) || buf instanceof Uint8Array).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  test('produced buffer can be re-parsed by exceljs', async () => {
    const data = [
      { 'First Name': 'Ahmad', 'Email': 'ahmad@school.com', 'Status': 'ACTIVE' },
      { 'First Name': 'Fatima', 'Email': 'fatima@school.com', 'Status': 'ACTIVE' }
    ];
    const buf = await buildWorkbook(data, 'Export');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets[0].name).toBe('Export');
    expect(wb.worksheets[0].rowCount).toBeGreaterThan(1); // header + data rows
  });

  test('handles empty data array without throwing', async () => {
    const buf = await buildWorkbook([], 'Empty');
    expect(buf.length).toBeGreaterThan(0);
  });
});

// ─── M. buildMultiSheetWorkbook ───────────────────────────────────────────────
describe('M. buildMultiSheetWorkbook — multiple sheets', () => {
  test('creates workbook with correct sheet count', async () => {
    const buf = await buildMultiSheetWorkbook([
      { name: 'Sheet1', data: [{ A: '1', B: '2' }] },
      { name: 'Sheet2', data: [{ X: 'hello', Y: 'world' }] }
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets).toHaveLength(2);
    expect(wb.worksheets[0].name).toBe('Sheet1');
    expect(wb.worksheets[1].name).toBe('Sheet2');
  });

  test('title rows are prepended before data', async () => {
    const buf = await buildMultiSheetWorkbook([{
      name: 'Report',
      data: [{ Metric: 'Total', Value: 10 }],
      titleRows: [['My Report Title'], ['Generated: 2026']]
    }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    // Row 1 should be the title
    const firstCellValue = ws.getRow(1).getCell(1).value;
    expect(String(firstCellValue)).toContain('My Report Title');
  });
});

// ─── N. Formula cells — no formula execution ─────────────────────────────────
describe('N. parseWorkbookBuffer — formula cells', () => {
  test('extracts formula result, not formula string', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['firstName', 'score']);
    // Add a row with a cached formula result
    const row = ws.addRow(['Ahmad', null]);
    row.getCell(2).value = { formula: 'SUM(1,2)', result: 3 };
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await parseWorkbookBuffer(buf);
    expect(rows[0].score).toBe('3'); // result extracted, not '=SUM(1,2)'
  });
});

// ─── O. No xlsx package ───────────────────────────────────────────────────────
describe('O. xlsx package absent from production tree', () => {
  test('xlsx cannot be required (package removed)', () => {
    expect(() => require('xlsx')).toThrow();
  });

  test('exceljs can be required successfully', () => {
    expect(() => require('exceljs')).not.toThrow();
  });

  test('import.controller.js does not reference xlsx', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/import.controller.js'), 'utf8'
    );
    expect(src).not.toMatch(/require\(['"]xlsx['"]\)/);
    expect(src).toMatch(/require.*excel/);
  });

  test('report.service.js does not reference xlsx', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../services/report.service.js'), 'utf8'
    );
    expect(src).not.toMatch(/require\(['"]xlsx['"]\)/);
  });

  test('student-report.controller.js does not reference xlsx', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/student-report.controller.js'), 'utf8'
    );
    expect(src).not.toMatch(/require\(['"]xlsx['"]\)/);
  });
});
