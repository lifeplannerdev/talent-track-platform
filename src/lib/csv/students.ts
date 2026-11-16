import { isValidUsername } from '../auth/username'
import { readCsvRows, type CsvError } from './rows'

export type Track = 'nursing' | 'other'
export const TRACKS: readonly Track[] = ['nursing', 'other']
export const MIN_PASSWORD_LENGTH = 8

export type NewStudent = { username: string; fullName: string; batch: string; track: Track; password: string }

export type StudentFields = { username: string; fullName: string; batch: string; track: string; password: string }

const REQUIRED_COLUMNS = ['username', 'full_name', 'batch', 'track', 'password']

/**
 * One validation for a new student, shared by the CSV import and the Add student form.
 * Messages never contain the password. The password is not trimmed (CSV values are trimmed
 * by the reader before they get here).
 */
export function validateStudentFields(
  fields: StudentFields,
): { ok: true; student: NewStudent } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message })
  const username = fields.username.trim().toLowerCase()
  const fullName = fields.fullName.trim()
  const batch = fields.batch.trim()
  const track = fields.track.trim().toLowerCase()
  const password = fields.password

  if (!username) return fail('Missing username')
  if (!isValidUsername(username)) {
    return fail(`Username "${username}" is invalid: use 3-40 characters: letters, digits, dot, underscore or hyphen`)
  }
  if (!fullName) return fail('Missing full name')
  if (!(TRACKS as readonly string[]).includes(track)) {
    return fail(`Unknown track "${fields.track.trim()}" (must be nursing or other)`)
  }
  if (!password) return fail('Missing password (staff set the first password)')
  if (password.length < MIN_PASSWORD_LENGTH) return fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)

  return { ok: true, student: { username, fullName, batch, track: track as Track, password } }
}

/**
 * Parses a staff CSV of new students (columns username, full_name, batch, track, password).
 * Same conventions as parseQuestionsCsv (see readCsvRows). Duplicate usernames within the file
 * (first occurrence wins) and usernames in `existingUsernames` are reported per row.
 */
export function parseStudentsCsv(
  text: string,
  opts: { existingUsernames?: Iterable<string> } = {},
): { valid: NewStudent[]; errors: CsvError[] } {
  const { valid, errors } = parseStudentsCsvWithRows(text, opts)
  return { valid: valid.map(({ row: _row, ...student }) => student), errors }
}

/** parseStudentsCsv, with the data row number of each valid student (for import reports). */
export function parseStudentsCsvWithRows(
  text: string,
  opts: { existingUsernames?: Iterable<string> } = {},
): { valid: (NewStudent & { row: number })[]; errors: CsvError[] } {
  const valid: (NewStudent & { row: number })[] = []
  const { rows, errors } = readCsvRows(text, REQUIRED_COLUMNS)
  const existing = new Set([...(opts.existingUsernames ?? [])].map((u) => u.toLowerCase()))
  const firstRow = new Map<string, number>()

  for (const { row, cell } of rows) {
    const result = validateStudentFields({
      username: cell('username'),
      fullName: cell('full_name'),
      batch: cell('batch'),
      track: cell('track'),
      password: cell('password'),
    })
    if (!result.ok) {
      errors.push({ row, message: result.message })
      continue
    }
    const { username } = result.student
    const earlier = firstRow.get(username)
    if (earlier !== undefined) {
      errors.push({ row, message: `Duplicate username "${username}" (also on row ${earlier})` })
      continue
    }
    firstRow.set(username, row)
    if (existing.has(username)) {
      errors.push({ row, message: `Username "${username}" is already taken` })
      continue
    }
    valid.push({ ...result.student, row })
  }

  return { valid, errors }
}
