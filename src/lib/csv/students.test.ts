import { describe, expect, it } from 'vitest'
import { parseStudentsCsv, validateStudentFields } from './students'

// TEST-ONLY passwords (never real credentials).
const HEADER = 'username,full_name,batch,track,password'
const anna = 'anna.k,Anna Kurian,B1,nursing,test-pass-anna'
const ben = 'ben_t,Ben Thomas,B2,other,test-pass-ben1'

describe('parseStudentsCsv', () => {
  it('parses a valid file', () => {
    const r = parseStudentsCsv([HEADER, anna, ben].join('\n'))
    expect(r.errors).toEqual([])
    expect(r.valid).toEqual([
      { username: 'anna.k', fullName: 'Anna Kurian', batch: 'B1', track: 'nursing', password: 'test-pass-anna', contactEmail: '' },
      { username: 'ben_t', fullName: 'Ben Thomas', batch: 'B2', track: 'other', password: 'test-pass-ben1', contactEmail: '' },
    ])
  })

  it('lower-cases usernames and tracks, and accepts case/whitespace-insensitive headers', () => {
    const r = parseStudentsCsvHeader(' Username , FULL_NAME,Batch ,TRACK,password')
    expect(r.errors).toEqual([])
    expect(r.valid[0]).toMatchObject({ username: 'anna.k', track: 'nursing' })
  })

  it('strips a UTF-8 BOM', () => {
    const r = parseStudentsCsv('﻿' + [HEADER, anna].join('\r\n'))
    expect(r.errors).toEqual([])
    expect(r.valid).toHaveLength(1)
  })

  it('detects semicolon-separated files (German Excel)', () => {
    const r = parseStudentsCsv(['username;full_name;batch;track;password', 'anna.k;Anna Kurian;B1;nursing;test-pass-anna'].join('\n'))
    expect(r.errors).toEqual([])
    expect(r.valid[0].fullName).toBe('Anna Kurian')
  })

  it('reports duplicate usernames within the file per row and keeps them out of valid', () => {
    const r = parseStudentsCsv([HEADER, anna, ben, 'Anna.K,Anna Two,B1,other,test-pass-two'].join('\n'))
    expect(r.valid.map((v) => v.username)).toEqual(['anna.k', 'ben_t'])
    expect(r.errors).toEqual([{ row: 3, message: 'Duplicate username "anna.k" (also on row 1)' }])
  })

  it('reports usernames that already exist', () => {
    const r = parseStudentsCsv([HEADER, anna, ben].join('\n'), { existingUsernames: ['ben_t'] })
    expect(r.valid.map((v) => v.username)).toEqual(['anna.k'])
    expect(r.errors).toEqual([{ row: 2, message: 'Username "ben_t" is already taken' }])
  })

  it('rejects a blank password and a short password', () => {
    const r = parseStudentsCsv([HEADER, 'anna.k,Anna Kurian,B1,nursing,', 'ben_t,Ben Thomas,B2,other,short7!'].join('\n'))
    expect(r.valid).toEqual([])
    expect(r.errors).toEqual([
      { row: 1, message: 'Missing password (staff set the first password)' },
      { row: 2, message: 'Password must be at least 8 characters' },
    ])
  })

  it('rejects an unknown track', () => {
    const r = parseStudentsCsv([HEADER, 'anna.k,Anna Kurian,B1,medicine,test-pass-anna'].join('\n'))
    expect(r.valid).toEqual([])
    expect(r.errors).toEqual([{ row: 1, message: 'Unknown track "medicine" (must be nursing or other)' }])
  })

  it('rejects invalid username characters and lengths', () => {
    const r = parseStudentsCsv(
      [HEADER, 'anna k,A,B1,other,test-pass-1', 'anna@x,A,B1,other,test-pass-1', 'ab,A,B1,other,test-pass-1', 'änna,A,B1,other,test-pass-1', `${'a'.repeat(41)},A,B1,other,test-pass-1`].join('\n'),
    )
    expect(r.valid).toEqual([])
    expect(r.errors.map((e) => e.row)).toEqual([1, 2, 3, 4, 5])
    for (const e of r.errors) {
      expect(e.message).toMatch(/Username .* 3-40 characters: letters, digits, dot, underscore or hyphen/)
    }
  })

  it('requires the full name and the username', () => {
    const r = parseStudentsCsv([HEADER, 'anna.k,,B1,nursing,test-pass-anna', ',Ben,B1,other,test-pass-ben1'].join('\n'))
    expect(r.errors).toEqual([
      { row: 1, message: 'Missing full name' },
      { row: 2, message: 'Missing username' },
    ])
  })

  it('allows a blank batch', () => {
    const r = parseStudentsCsv([HEADER, 'anna.k,Anna Kurian,,nursing,test-pass-anna'].join('\n'))
    expect(r.errors).toEqual([])
    expect(r.valid[0].batch).toBe('')
  })

  it('skips blank rows but keeps row numbers positional', () => {
    const r = parseStudentsCsv([HEADER, anna, '', ' , , , , ', 'xavier,No Track,B1,,test-pass-xx1'].join('\n'))
    expect(r.valid).toHaveLength(1)
    expect(r.errors).toEqual([{ row: 4, message: 'Unknown track "" (must be nursing or other)' }])
  })

  it('reports a missing column once as row 0', () => {
    const r = parseStudentsCsv(['username,full_name,batch,password', 'anna.k,Anna,B1,test-pass-anna'].join('\n'))
    expect(r.valid).toEqual([])
    expect(r.errors).toEqual([{ row: 0, message: 'Missing required column(s): track' }])
  })

  it('rejects rows with extra non-empty columns, but tolerates trailing empty cells', () => {
    const r = parseStudentsCsv([HEADER, anna + ',surprise', ben + ',,'].join('\n'))
    expect(r.valid.map((v) => v.username)).toEqual(['ben_t'])
    expect(r.errors).toEqual([{ row: 1, message: 'Too many columns; put text containing the separator in quotes' }])
  })

  it('rejects a row whose named cells are blank but which has non-empty extra cells', () => {
    const r = parseStudentsCsv([HEADER, ',,,,,surprise', ben].join('\n'))
    expect(r.valid.map((v) => v.username)).toEqual(['ben_t'])
    expect(r.errors).toEqual([{ row: 1, message: 'Too many columns; put text containing the separator in quotes' }])
  })

  it('is safe against prototype keys in the header and values', () => {
    const r = parseStudentsCsv(['__proto__,username,full_name,batch,track,password', 'x,constructor,Proto,B1,other,test-pass-proto'].join('\n'))
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(r.errors).toEqual([])
    expect(r.valid[0].username).toBe('constructor')
  })

  it('reports a quoted CSV password with outer spaces instead of trimming it', () => {
    const r = parseStudentsCsv([HEADER, 'anna.k,Anna,B1,nursing," test-pass-anna"'].join('\n'))
    expect(r.valid).toEqual([])
    expect(r.errors).toEqual([{ row: 1, message: 'Password must not start or end with a space' }])
  })

  it('never puts a password into an error message', () => {
    const r = parseStudentsCsv([HEADER, 'bad name,Anna,B1,nursing,test-secret-pw', 'ok.name,Anna,B1,weird,test-secret-pw2'].join('\n'))
    expect(JSON.stringify(r.errors)).not.toContain('test-secret-pw')
  })
})

describe('validateStudentFields', () => {
  it('returns the normalised student for a valid input', () => {
    expect(
      validateStudentFields({ username: ' Anna.K ', fullName: ' Anna ', batch: ' B1 ', track: 'Nursing', password: 'test-pass-anna' }),
    ).toEqual({ ok: true, student: { username: 'anna.k', fullName: 'Anna', batch: 'B1', track: 'nursing', password: 'test-pass-anna', contactEmail: '' } })
  })

  it('keeps inner spaces in the password', () => {
    const r = validateStudentFields({ username: 'anna.k', fullName: 'A', batch: '', track: 'other', password: 'test pass word' })
    expect(r).toMatchObject({ ok: true, student: { password: 'test pass word' } })
  })

  it('rejects a password with leading or trailing whitespace (the CSV reader would trim it silently)', () => {
    for (const password of [' test-pass', 'test-pass ', '\ttest-pass']) {
      expect(validateStudentFields({ username: 'anna.k', fullName: 'A', batch: '', track: 'other', password })).toEqual({
        ok: false,
        message: 'Password must not start or end with a space',
      })
    }
  })

  it('returns the first problem as a message', () => {
    expect(validateStudentFields({ username: 'anna.k', fullName: 'A', batch: '', track: 'other', password: 'short' })).toEqual({
      ok: false,
      message: 'Password must be at least 8 characters',
    })
  })
})

describe('student detail fields', () => {
  const base = { username: 'anna.k', fullName: 'Anna', batch: '', track: 'other', password: 'test-pass-anna' }

  it('keeps contactEmail empty and details absent when the new fields are not given', () => {
    expect(validateStudentFields(base)).toEqual({
      ok: true,
      student: { username: 'anna.k', fullName: 'Anna', batch: '', track: 'other', password: 'test-pass-anna', contactEmail: '' },
    })
  })

  it('requires a contact email only when asked to', () => {
    expect(validateStudentFields(base, { requireContactEmail: true })).toEqual({ ok: false, message: 'Missing contact email' })
    expect(validateStudentFields({ ...base, contactEmail: 'nope' }, { requireContactEmail: true })).toMatchObject({ ok: false })
    expect(validateStudentFields({ ...base, contactEmail: ' Anna@Example.com ' }, { requireContactEmail: true })).toMatchObject({
      ok: true,
      student: { contactEmail: 'anna@example.com' },
    })
  })

  it('validates a contact email that is given even when not required', () => {
    expect(validateStudentFields({ ...base, contactEmail: 'nope' })).toMatchObject({ ok: false })
  })

  it('builds details from the given detail fields', () => {
    const r = validateStudentFields({
      ...base,
      contactEmail: 'a@b.co',
      details: { germanLevel: 'B1', passportExpiry: '2030-01-01' },
    })
    expect(r).toMatchObject({ ok: true, student: { details: { contactEmail: 'a@b.co', germanLevel: 'B1', passportExpiry: '2030-01-01' } } })
  })

  it('refuses detail fields without a contact email', () => {
    expect(validateStudentFields({ ...base, details: { germanLevel: 'B1' } })).toEqual({
      ok: false,
      message: 'Missing contact email (needed to save student details)',
    })
  })

  it('reports invalid detail fields without the password', () => {
    const r = validateStudentFields({ ...base, contactEmail: 'a@b.co', details: { germanLevel: 'Z9' } })
    expect(r).toMatchObject({ ok: false })
    expect(JSON.stringify(r)).not.toContain('test-pass-anna')
  })
})

describe('parseStudentsCsv optional detail columns', () => {
  const FULL =
    HEADER + ',contact_email,phone,passport_number,destination_country,german_level,programme_start'

  it('still parses a file without the new columns', () => {
    const r = parseStudentsCsv([HEADER, anna].join('\n'))
    expect(r.errors).toEqual([])
    expect(r.valid[0].contactEmail).toBe('')
    expect(r.valid[0].details).toBeUndefined()
  })

  it('reads the optional columns into details', () => {
    const r = parseStudentsCsv(
      [FULL, anna + ',Anna@Example.com,+91 98765 43210,P1234567,Germany,b1,2026-12-01'].join('\n'),
    )
    expect(r.errors).toEqual([])
    expect(r.valid[0]).toMatchObject({
      contactEmail: 'anna@example.com',
      details: {
        contactEmail: 'anna@example.com',
        phone: '+91 98765 43210',
        passportNumber: 'P1234567',
        destinationCountry: 'Germany',
        germanLevel: 'B1',
        programmeStart: '2026-12-01',
      },
    })
  })

  it('leaves details out for a row where every optional cell is blank', () => {
    const r = parseStudentsCsv([FULL, anna + ',,,,,,'].join('\n'))
    expect(r.errors).toEqual([])
    expect(r.valid[0].details).toBeUndefined()
  })

  it('reports a bad german_level, email and date as row errors', () => {
    const r = parseStudentsCsv(
      [
        FULL,
        anna + ',a@b.co,,,,C2,',
        'ben_t,Ben,B2,other,test-pass-ben1,not-an-email,,,,,',
        'cy.x,Cy,B2,other,test-pass-cy11,c@d.co,,,,,01/12/2026',
        'di.y,Di,B2,other,test-pass-di11,,,,Germany,,',
      ].join('\n'),
    )
    expect(r.valid).toEqual([])
    expect(r.errors.map((e) => e.row)).toEqual([1, 2, 3, 4])
    expect(r.errors[0].message).toMatch(/German level "C2"/)
    expect(r.errors[1].message).toMatch(/email/i)
    expect(r.errors[2].message).toMatch(/yyyy-mm-dd/)
    expect(r.errors[3].message).toMatch(/contact email/i)
    expect(JSON.stringify(r.errors)).not.toContain('test-pass')
  })
})

function parseStudentsCsvHeader(header: string) {
  return parseStudentsCsv([header, anna].join('\n'))
}
