import Papa from 'papaparse'

export type CsvError = { row: number; message: string }

/**
 * One non-blank data row. `cell` returns the trimmed value of a (lower-case) column, or '';
 * `rawCell` the value exactly as written (for passwords, where trimming would change the value).
 */
export type CsvRow = { row: number; cell: (column: string) => string; rawCell: (column: string) => string }

/**
 * Shared CSV conventions for staff imports (questions, students):
 * - UTF-8 BOM stripped; delimiter auto-detected (comma, semicolon as written by German-locale
 *   Excel, tab); headers compared trimmed and lower-case; values trimmed by `cell`.
 * - Row numbers are 1-based data rows: the header is not counted and blank rows still count,
 *   so the number matches the data row position in the file. Blank rows are skipped.
 * - A missing required column is one error with row 0 and no rows.
 * - A row with malformed quoting, or with extra non-empty cells beyond the header (data would
 *   be silently dropped), is reported once and never returned.
 * - Values are read only from own properties, so header names like __proto__ are harmless.
 */
export function readCsvRows(
  text: string,
  requiredColumns: readonly string[],
): { rows: CsvRow[]; errors: CsvError[] } {
  const rows: CsvRow[] = []
  const errors: CsvError[] = []

  const parsed = Papa.parse<Record<string, unknown>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: false,
    delimitersToGuess: [',', ';', '\t'],
    transformHeader: (h) => h.replace(/^﻿/, '').trim().toLowerCase(),
  })

  const fields = parsed.meta.fields ?? []
  const missing = requiredColumns.filter((c) => !fields.includes(c))
  if (missing.length > 0) {
    return { rows, errors: [{ row: 0, message: `Missing required column(s): ${missing.join(', ')}` }] }
  }

  // Only malformed quoting is a real problem; field-count mismatches on blank or short rows are
  // handled by the per-row validation. Papa error rows are already 1-based data rows.
  const quoteErrorRows = new Set<number>()
  for (const e of parsed.errors) {
    if (e.type === 'Quotes' && typeof e.row === 'number' && !quoteErrorRows.has(e.row - 1)) {
      quoteErrorRows.add(e.row - 1)
      errors.push({ row: e.row, message: `Malformed quoting: ${e.message}` })
    }
  }

  parsed.data.forEach((raw, index) => {
    const row = index + 1
    if (quoteErrorRows.has(index)) return
    if (Object.values(raw).every((v) => typeof v !== 'string' || !v.trim())) return

    // Papa puts cells beyond the header width in __parsed_extra; trailing empty cells are
    // harmless, anything else means data would be silently dropped.
    const extra = Object.hasOwn(raw, '__parsed_extra') ? raw.__parsed_extra : undefined
    if (Array.isArray(extra) && extra.some((v) => typeof v === 'string' && v.trim())) {
      errors.push({ row, message: 'Too many columns; put text containing the separator in quotes' })
      return
    }

    const rawCell = (column: string) => {
      const v = Object.hasOwn(raw, column) ? raw[column] : undefined
      return typeof v === 'string' ? v : ''
    }
    rows.push({ row, cell: (column) => rawCell(column).trim(), rawCell })
  })

  return { rows, errors }
}

/** Copy of a parsed entry without its row number. */
export function withoutRow<T extends { row: number }>(entry: T): Omit<T, 'row'> {
  const copy: Partial<T> = { ...entry }
  delete copy.row
  return copy as Omit<T, 'row'>
}
