import { describe, expect, it } from 'vitest'
import nextConfig from '../../../next.config'
import { QUESTION_CSV_MAX_BYTES, STUDENT_CSV_MAX_BYTES, utf8Bytes } from './limits'

describe('CSV caps', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('Übung')).toBe(6)
  })

  it('the server action body limit leaves room above the largest cap (JSON escaping can double a CSV)', () => {
    const limit = nextConfig.experimental?.serverActions?.bodySizeLimit
    expect(typeof limit).toBe('string')
    const mb = Number(/^(\d+)mb$/.exec(String(limit))?.[1])
    expect(mb * 1024 * 1024).toBeGreaterThanOrEqual(2 * Math.max(QUESTION_CSV_MAX_BYTES, STUDENT_CSV_MAX_BYTES) + 64 * 1024)
  })
})
