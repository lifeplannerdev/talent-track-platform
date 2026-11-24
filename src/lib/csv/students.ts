import { isValidUsername } from '../auth/username'
import { readCsvRows, withoutRow, type CsvError } from './rows'
import { isValidContactEmail, validateStudentDetails, type StudentDetails, type StudentDetailsInput } from '../student-details'

export type Track = 'nursing' | 'other'
export const TRACKS: readonly Track[] = ['nursing', 'other']
export const MIN_PASSWORD_LENGTH = 8

export type NewStudent = {
  username: string
  fullName: string
  batch: string
  track: Track
  password: string
  /** Lower-case contact email, '' when none was given. */
  contactEmail: string
  /** Present whenever a contact email was given (the table needs it); undefined otherwise. */
  details?: StudentDetails
}

export type StudentFields = {
  username: string
  fullName: string
  batch: string
  track: string
  password: string
  contactEmail?: string
  /** Raw detail fields (everything except contactEmail, which is the field above). */
  details?: StudentDetailsInput
}

const DETAIL_COLUMNS: Record<string, keyof StudentDetails> = {
  phone: 'phone',
  passport_number: 'passportNumber',
  destination_country: 'destinationCountry',
  german_level: 'germanLevel',
  programme_start: 'programmeStart',
}

const REQUIRED_COLUMNS = ['username', 'full_name', 'batch', 'track', 'password']

/**
 * The password rule for first passwords and resets (null when acceptable). Outer whitespace is
 * refused rather than trimmed, so the manual form and the CSV import accept the same passwords.
 * Messages never contain the password.
 */
export function checkPassword(password: string): string | null {
  if (!password) return 'Missing password (staff set the first password)'
  if (password.trim() !== password) return 'Password must not start or end with a space'
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  return null
}

/**
 * One validation for a new student, shared by the CSV import and the Add student form.
 * Messages never contain the password. The password is never trimmed (see checkPassword).
 */
export function validateStudentFields(
  fields: StudentFields,
  opts: { requireContactEmail?: boolean; now?: Date } = {},
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
  const passwordProblem = checkPassword(password)
  if (passwordProblem) return fail(passwordProblem)

  const contactEmail = (fields.contactEmail ?? '').trim().toLowerCase()
  if (!contactEmail && opts.requireContactEmail) return fail('Missing contact email')
  if (contactEmail && !isValidContactEmail(contactEmail)) return fail('Contact email is not a valid email address')

  const student: NewStudent = { username, fullName, batch, track: track as Track, password, contactEmail }
  const given = Object.values(fields.details ?? {}).some((v) => typeof v === 'string' && v.trim())
  if (given && !contactEmail) return fail('Missing contact email (needed to save student details)')
  if (contactEmail) {
    const checked = validateStudentDetails({ ...fields.details, contactEmail }, opts.now)
    if (!checked.ok) return checked
    student.details = checked.details
  }
  return { ok: true, student }
}

/**
 * Parses a staff CSV of new students (columns username, full_name, batch, track, password; optional contact_email, phone, passport_number,
 * destination_country, german_level, programme_start).
 * Same conventions as parseQuestionsCsv (see readCsvRows). Duplicate usernames within the file
 * (first occurrence wins) and usernames in `existingUsernames` are reported per row.
 */
export function parseStudentsCsv(
  text: string,
  opts: { existingUsernames?: Iterable<string> } = {},
): { valid: NewStudent[]; errors: CsvError[] } {
  const { valid, errors } = parseStudentsCsvWithRows(text, opts)
  return { valid: valid.map(withoutRow), errors }
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

  for (const { row, cell, rawCell } of rows) {
    const details: StudentDetailsInput = {}
    for (const [column, key] of Object.entries(DETAIL_COLUMNS)) details[key] = cell(column)
    const result = validateStudentFields({
      username: cell('username'),
      fullName: cell('full_name'),
      batch: cell('batch'),
      track: cell('track'),
      password: rawCell('password'),
      contactEmail: cell('contact_email'),
      details,
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
