import { describe, expect, it } from 'vitest'
import {
  GERMAN_LEVELS,
  STUDENT_STATUSES,
  detailsToRow,
  rowToDetails,
  validateStudentDetails,
} from './student-details'

const NOW = new Date('2026-11-24T10:00:00Z')

describe('validateStudentDetails', () => {
  it('accepts a contact email alone and fills the defaults', () => {
    const r = validateStudentDetails({ contactEmail: ' Anna@Example.com ' }, NOW)
    expect(r).toEqual({
      ok: true,
      details: {
        contactEmail: 'anna@example.com',
        phone: null,
        guardianName: null,
        guardianPhone: null,
        dateOfBirth: null,
        gender: null,
        address: null,
        passportNumber: null,
        passportExpiry: null,
        destinationCountry: null,
        targetIntake: null,
        germanLevel: null,
        qualification: null,
        joinedOn: null,
        programmeStart: null,
        status: 'active',
        notes: null,
      },
    })
  })

  it('requires a valid contact email', () => {
    for (const contactEmail of [undefined, '', '  ', 'nope', 'a@b', 'a b@c.com', '@c.com']) {
      const r = validateStudentDetails({ contactEmail }, NOW)
      expect(r.ok).toBe(false)
      expect(r).toMatchObject({ message: expect.stringMatching(/email/i) })
    }
  })

  it('accepts German levels A0 to C1 and rejects others', () => {
    expect([...GERMAN_LEVELS]).toEqual(['A0', 'A1', 'A2', 'B1', 'B2', 'C1'])
    for (const germanLevel of GERMAN_LEVELS) {
      expect(validateStudentDetails({ contactEmail: 'a@b.co', germanLevel }, NOW)).toMatchObject({ ok: true })
    }
    const r = validateStudentDetails({ contactEmail: 'a@b.co', germanLevel: 'C2' }, NOW)
    expect(r).toEqual({ ok: false, message: 'German level "C2" is not valid (A0, A1, A2, B1, B2 or C1)' })
  })

  it('accepts the four statuses and rejects others', () => {
    expect([...STUDENT_STATUSES]).toEqual(['active', 'on_hold', 'completed', 'dropped'])
    expect(validateStudentDetails({ contactEmail: 'a@b.co', status: 'on_hold' }, NOW)).toMatchObject({
      ok: true,
      details: { status: 'on_hold' },
    })
    expect(validateStudentDetails({ contactEmail: 'a@b.co', status: 'gone' }, NOW)).toMatchObject({ ok: false })
  })

  it('refuses a passport that expired before today, accepts today and later', () => {
    expect(validateStudentDetails({ contactEmail: 'a@b.co', passportExpiry: '2026-11-23' }, NOW)).toEqual({
      ok: false,
      message: 'Passport expiry 2026-11-23 is in the past',
    })
    expect(validateStudentDetails({ contactEmail: 'a@b.co', passportExpiry: '2026-11-24' }, NOW)).toMatchObject({ ok: true })
    expect(validateStudentDetails({ contactEmail: 'a@b.co', passportExpiry: '2030-01-01' }, NOW)).toMatchObject({ ok: true })
  })

  it('requires ISO yyyy-mm-dd dates that exist on the calendar', () => {
    for (const programmeStart of ['24/11/2026', '2026-1-5', '2026-02-30', '2026-13-01', 'tomorrow', '2026-11-24T00:00']) {
      const r = validateStudentDetails({ contactEmail: 'a@b.co', programmeStart }, NOW)
      expect(r).toMatchObject({ ok: false, message: expect.stringContaining('yyyy-mm-dd') })
    }
    expect(validateStudentDetails({ contactEmail: 'a@b.co', joinedOn: '2024-02-29' }, NOW)).toMatchObject({ ok: true })
    expect(validateStudentDetails({ contactEmail: 'a@b.co', joinedOn: '2025-02-29' }, NOW)).toMatchObject({ ok: false })
  })

  it('refuses a date of birth in the future', () => {
    expect(validateStudentDetails({ contactEmail: 'a@b.co', dateOfBirth: '2027-01-01' }, NOW)).toMatchObject({ ok: false })
    expect(validateStudentDetails({ contactEmail: 'a@b.co', dateOfBirth: '2004-05-06' }, NOW)).toMatchObject({ ok: true })
  })

  it('checks phone numbers loosely and treats blanks as null', () => {
    expect(validateStudentDetails({ contactEmail: 'a@b.co', phone: '+91 98765 43210' }, NOW)).toMatchObject({
      ok: true,
      details: { phone: '+91 98765 43210' },
    })
    expect(validateStudentDetails({ contactEmail: 'a@b.co', phone: 'call me' }, NOW)).toMatchObject({ ok: false })
    expect(validateStudentDetails({ contactEmail: 'a@b.co', phone: '  ', notes: '' }, NOW)).toMatchObject({
      ok: true,
      details: { phone: null, notes: null },
    })
  })
})

describe('detailsToRow and rowToDetails', () => {
  it('round-trips through the snake_case table columns', () => {
    const r = validateStudentDetails(
      {
        contactEmail: 'a@b.co',
        passportNumber: 'P1234567',
        passportExpiry: '2030-01-01',
        destinationCountry: 'Germany',
        germanLevel: 'B1',
        programmeStart: '2026-12-01',
        status: 'completed',
      },
      NOW,
    )
    if (!r.ok) throw new Error(r.message)
    const row = detailsToRow(r.details)
    expect(row).toMatchObject({
      contact_email: 'a@b.co',
      passport_number: 'P1234567',
      passport_expiry: '2030-01-01',
      destination_country: 'Germany',
      german_level: 'B1',
      programme_start: '2026-12-01',
      guardian_name: null,
      status: 'completed',
    })
    expect(rowToDetails(row)).toEqual(r.details)
  })

  it('rowToDetails ignores extra columns and maps missing ones to null', () => {
    const d = rowToDetails({ student_id: 'x', contact_email: 'a@b.co', status: 'active', created_at: 'now' })
    expect(d.contactEmail).toBe('a@b.co')
    expect(d.phone).toBeNull()
    expect(d).not.toHaveProperty('studentId')
  })
})
