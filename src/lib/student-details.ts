/**
 * Study-abroad details of a student (table public.student_details, migration 0026). Pure
 * validation and row mapping; persistence is elsewhere. Personal data: never log these values.
 */
export const GERMAN_LEVELS = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1'] as const
export type GermanLevel = (typeof GERMAN_LEVELS)[number]

export const STUDENT_STATUSES = ['active', 'on_hold', 'completed', 'dropped'] as const
export type StudentStatus = (typeof STUDENT_STATUSES)[number]

export type StudentDetails = {
  contactEmail: string
  phone: string | null
  guardianName: string | null
  guardianPhone: string | null
  dateOfBirth: string | null
  gender: string | null
  address: string | null
  passportNumber: string | null
  passportExpiry: string | null
  destinationCountry: string | null
  targetIntake: string | null
  germanLevel: GermanLevel | null
  qualification: string | null
  joinedOn: string | null
  programmeStart: string | null
  status: StudentStatus
  notes: string | null
}

export type StudentDetailsInput = Partial<Record<keyof StudentDetails, string>>

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/
// Leading "+", "(" or a digit, then digits, spaces, dots, dashes, slashes and parentheses.
const PHONE = /^[+(0-9][0-9 ().\/-]*$/
const PHONE_MAX_LENGTH = 25
const PHONE_MIN_DIGITS = 7
const IST_OFFSET_MS = 330 * 60 * 1000
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a real calendar date written yyyy-mm-dd. */
function isRealIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

function isValidPhone(value: string): boolean {
  return value.length <= PHONE_MAX_LENGTH && PHONE.test(value) && value.replace(/\D/g, '').length >= PHONE_MIN_DIGITS
}

/** The calendar date (yyyy-mm-dd) in Asia/Kolkata at `now`. */
function istDate(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

export function isValidContactEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value)
}

/**
 * Validates and normalises the raw (string) fields. Blank optional fields become null, the
 * contact email is required (the table says not null), the status defaults to 'active'.
 * `now` supplies "today" (the Asia/Kolkata calendar date) for the passport and birth-date checks.
 * `keepExpiry` is the passport expiry already stored: submitting that same value again is not
 * refused for being in the past (the rule applies to new or changed values only).
 */
export function validateStudentDetails(
  input: StudentDetailsInput,
  now: Date = new Date(),
  opts: { keepExpiry?: string | null } = {},
): { ok: true; details: StudentDetails } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message })
  const text = (key: keyof StudentDetails): string | null => {
    const v = (input[key] ?? '').trim()
    return v === '' ? null : v
  }
  const today = istDate(now)

  const email = (input.contactEmail ?? '').trim().toLowerCase()
  if (!email) return fail('Missing contact email')
  if (!isValidContactEmail(email)) return fail('Contact email is not a valid email address')

  for (const key of ['phone', 'guardianPhone'] as const) {
    const v = text(key)
    if (v !== null && !isValidPhone(v)) {
      return fail(`${key === 'phone' ? 'Phone' : 'Guardian phone'} number is not valid (at least 7 digits; spaces, + ( ) . - / allowed)`)
    }
  }

  const dateLabels = {
    dateOfBirth: 'Date of birth',
    passportExpiry: 'Passport expiry',
    joinedOn: 'Joined on',
    programmeStart: 'Programme start',
  } as const
  const dates: Record<string, string | null> = {}
  for (const key of Object.keys(dateLabels) as (keyof typeof dateLabels)[]) {
    const v = text(key)
    if (v !== null && !isRealIsoDate(v)) return fail(`${dateLabels[key]} must be a real date written yyyy-mm-dd`)
    dates[key] = v
  }
  if (dates.passportExpiry && dates.passportExpiry < today && dates.passportExpiry !== opts.keepExpiry) {
    return fail(`Passport expiry ${dates.passportExpiry} is in the past`)
  }
  if (dates.dateOfBirth && dates.dateOfBirth > today) return fail('Date of birth is in the future')

  const levelRaw = text('germanLevel')
  const level = levelRaw === null ? null : levelRaw.toUpperCase()
  if (level !== null && !(GERMAN_LEVELS as readonly string[]).includes(level)) {
    return fail(`German level "${levelRaw}" is not valid (A0, A1, A2, B1, B2 or C1)`)
  }

  const statusRaw = text('status')
  const status = statusRaw === null ? 'active' : statusRaw.toLowerCase()
  if (!(STUDENT_STATUSES as readonly string[]).includes(status)) {
    return fail(`Status "${statusRaw}" is not valid (active, on_hold, completed or dropped)`)
  }

  return {
    ok: true,
    details: {
      contactEmail: email,
      phone: text('phone'),
      guardianName: text('guardianName'),
      guardianPhone: text('guardianPhone'),
      dateOfBirth: dates.dateOfBirth,
      gender: text('gender'),
      address: text('address'),
      passportNumber: text('passportNumber'),
      passportExpiry: dates.passportExpiry,
      destinationCountry: text('destinationCountry'),
      targetIntake: text('targetIntake'),
      germanLevel: level as GermanLevel | null,
      qualification: text('qualification'),
      joinedOn: dates.joinedOn,
      programmeStart: dates.programmeStart,
      status: status as StudentStatus,
      notes: text('notes'),
    },
  }
}

/** camelCase key -> snake_case column of student_details. */
const COLUMNS: Record<keyof StudentDetails, string> = {
  contactEmail: 'contact_email',
  phone: 'phone',
  guardianName: 'guardian_name',
  guardianPhone: 'guardian_phone',
  dateOfBirth: 'date_of_birth',
  gender: 'gender',
  address: 'address',
  passportNumber: 'passport_number',
  passportExpiry: 'passport_expiry',
  destinationCountry: 'destination_country',
  targetIntake: 'target_intake',
  germanLevel: 'german_level',
  qualification: 'qualification',
  joinedOn: 'joined_on',
  programmeStart: 'programme_start',
  status: 'status',
  notes: 'notes',
}

/** Table columns for an insert or update (without student_id and the timestamps). */
export function detailsToRow(details: StudentDetails): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const key of Object.keys(COLUMNS) as (keyof StudentDetails)[]) row[COLUMNS[key]] = details[key]
  return row
}

/** A student_details row (extra columns ignored, missing optional ones null). */
export function rowToDetails(row: Record<string, unknown>): StudentDetails {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(COLUMNS) as (keyof StudentDetails)[]) {
    const v = row[COLUMNS[key]]
    out[key] = v === undefined ? (key === 'status' ? 'active' : key === 'contactEmail' ? '' : null) : v
  }
  return out as StudentDetails
}
