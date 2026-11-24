// Size caps for staff CSV imports, in UTF-8 bytes. The Server Action body limit in next.config.ts
// (experimental.serverActions.bodySizeLimit) is set well above these, because the CSV travels
// JSON-encoded and escaping can grow it.
export const QUESTION_CSV_MAX_BYTES = 2_000_000
export const STUDENT_CSV_MAX_BYTES = 1_000_000
// Students per import file. Each created student is followed by an invite mail (up to 8 s each,
// one after the other), so the whole import must fit the host's function time limit.
export const STUDENT_CSV_MAX_ROWS = 200

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}
