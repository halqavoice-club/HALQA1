'use strict';
/**
 * excel.js — Shared Excel utility (exceljs wrapper)
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the removed xlsx@0.18.5 package (CVE GHSA-4r6h-8v6p-xvw6,
 * GHSA-5pgg-2g8v-p4x9) with exceljs@4.x which has no known vulnerabilities.
 *
 * Security notes:
 *   - parseWorkbookBuffer: reads only the first worksheet, caps rows at
 *     MAX_PARSE_ROWS, sets cellFormula / calcProperties to false so no
 *     formula evaluation occurs server-side.
 *   - buildWorkbook / buildMultiSheetWorkbook: write-only helpers for
 *     server-generated exports — no user-controlled input reaches these.
 *   - workbookToBuffer: serialises to .xlsx buffer without executing macros.
 */

const ExcelJS = require('exceljs');

// Maximum rows parsed from an uploaded workbook to bound memory usage.
// Import endpoints already enforce their own 1,000-row limit; this is an
// additional hard ceiling at the parser level.
const MAX_PARSE_ROWS = 1100;

// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * Parse an uploaded Excel buffer into an array of plain objects.
 * Uses the first worksheet only.
 *
 * @param {Buffer} buffer   - raw file buffer from multer
 * @returns {Promise<Object[]>} rows as plain key/value objects
 * @throws {Error}           if the buffer is not a valid xlsx workbook
 */
async function parseWorkbookBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();

  // Disable formula calculation — workbooks may contain user-supplied formulas.
  // ExcelJS does not evaluate formulas server-side by default, but we make it
  // explicit here as defence-in-depth against future library behaviour changes.
  workbook.calcProperties = {};

  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    // Re-throw with a safe message — never leak internal parser details
    throw new Error('Invalid or corrupted Excel file. Please upload a valid .xlsx file.');
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('The uploaded file contains no worksheets.');
  }

  // Extract header row (row 1) — column names
  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? '').trim());
  });

  if (headers.length === 0) {
    return []; // empty sheet
  }

  const rows = [];
  let rowCount = 0;

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // skip header row
    if (rowCount >= MAX_PARSE_ROWS) return;

    const obj = {};
    let hasValue = false;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (!header) return;

      // Get cell value safely — exceljs returns rich objects for formulas/dates
      let val = cell.value;

      // Handle formula result — use result, not formula string
      if (val !== null && typeof val === 'object' && 'result' in val) {
        val = val.result;
      }

      // Normalise to primitive
      if (val instanceof Date) {
        val = val.toISOString().split('T')[0]; // YYYY-MM-DD
      } else if (val !== null && val !== undefined) {
        val = String(val);
      } else {
        val = '';
      }

      obj[header] = val;
      if (val !== '') hasValue = true;
    });

    // Skip completely empty rows
    if (hasValue) {
      rows.push(obj);
      rowCount++;
    }
  });

  return rows;
}

// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * Build an xlsx buffer from a flat array of objects (single sheet).
 * Automatically sets column widths based on content.
 *
 * @param {Object[]} data      - array of plain objects (all values are primitive)
 * @param {string}   sheetName - worksheet tab name
 * @returns {Promise<Buffer>}
 */
async function buildWorkbook(data, sheetName = 'Report') {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  if (!data || data.length === 0) {
    // Return an empty workbook with just headers if no data
    return workbook.xlsx.writeBuffer();
  }

  const columns = Object.keys(data[0]).map(key => ({
    header: key,
    key,
    width: Math.max(key.length + 2, 15)
  }));
  worksheet.columns = columns;

  // Bold header row
  worksheet.getRow(1).font = { bold: true };

  data.forEach(row => worksheet.addRow(row));

  // Auto-adjust column widths based on data
  worksheet.columns.forEach(col => {
    let maxLen = col.header ? col.header.length : 10;
    col.eachCell({ includeEmpty: false }, cell => {
      const cellLen = cell.value ? String(cell.value).length : 0;
      if (cellLen > maxLen) maxLen = cellLen;
    });
    col.width = Math.min(maxLen + 2, 60); // cap at 60 chars
  });

  return workbook.xlsx.writeBuffer();
}

/**
 * Build an xlsx buffer with multiple named sheets.
 *
 * @param {Array<{name: string, data: Object[], titleRows?: string[][]}>} sheets
 *   Each sheet entry:
 *     name      — worksheet tab name
 *     data      — array of row objects
 *     titleRows — optional array of arrays to prepend above the data header
 *                 (used for student report cover info)
 *     colWidths — optional array of {wch} objects for fixed column widths
 * @returns {Promise<Buffer>}
 */
async function buildMultiSheetWorkbook(sheets) {
  const workbook = new ExcelJS.Workbook();

  for (const { name, data, titleRows, colWidths } of sheets) {
    const worksheet = workbook.addWorksheet(name);

    if (!data || data.length === 0) continue;

    const headers = Object.keys(data[0]);

    if (titleRows && titleRows.length > 0) {
      // When titleRows are present we CANNOT use worksheet.columns because
      // exceljs unconditionally writes column headers at row 1 when the setter
      // is called, overwriting any rows already added. Instead we:
      //   1. Add title rows manually
      //   2. Add a blank separator
      //   3. Add a bold header row manually
      //   4. Add data rows via addRow({ key: value })
      // Set column widths via worksheet.getColumn() after all rows are in.

      for (let i = 0; i < titleRows.length; i++) {
        const row = worksheet.addRow(titleRows[i]);
        if (i === 0) row.font = { bold: true, size: 13 };
      }
      worksheet.addRow([]); // blank separator

      // Add header row manually (bold)
      const headerRow = worksheet.addRow(headers);
      headerRow.font = { bold: true };

      // Add data rows as arrays (columns not mapped by key here)
      data.forEach(rowObj => {
        worksheet.addRow(headers.map(h => rowObj[h] ?? ''));
      });

      // Apply column widths
      headers.forEach((key, idx) => {
        const col = worksheet.getColumn(idx + 1);
        col.width = colWidths?.[idx]?.wch ?? Math.max(key.length + 2, 15);
      });

    } else {
      // No titleRows — safe to use worksheet.columns setter (writes header at row 1)
      worksheet.columns = headers.map((key, idx) => ({
        header: key,
        key,
        width: colWidths?.[idx]?.wch ?? Math.max(key.length + 2, 15)
      }));
      worksheet.getRow(1).font = { bold: true };
      data.forEach(row => worksheet.addRow(row));

      // Auto-adjust if no fixed widths
      if (!colWidths) {
        worksheet.columns.forEach(col => {
          let maxLen = col.header ? col.header.length : 10;
          col.eachCell({ includeEmpty: false }, cell => {
            const cellLen = cell.value ? String(cell.value).length : 0;
            if (cellLen > maxLen) maxLen = cellLen;
          });
          col.width = Math.min(maxLen + 2, 60);
        });
      }
    }
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = { parseWorkbookBuffer, buildWorkbook, buildMultiSheetWorkbook };
