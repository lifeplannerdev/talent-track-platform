// Size caps for staff CSV imports, in UTF-8 bytes. The Server Action body limit in next.config.ts
// (experimental.serverActions.bodySizeLimit) is set well above these, because the CSV travels
// JSON-encoded and escaping can grow it.
export const QUESTION_CSV_MAX_BYTES = 2_000_000
export const STUDENT_CSV_MAX_BYTES = 1_000_000

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}
