import { describe, expect, it, vi } from "vitest"
import { putWithRetry } from "./upload-put"

const blob = new Blob(["x"])
const dup = () => new Response(JSON.stringify({ statusCode: "409", error: "Duplicate", message: "The resource already exists" }), { status: 400 })
const fail = (status: number) => () => new Response("nope", { status })
const seq = (...makers: (() => Response | Error)[]) => {
  const f = vi.fn(async () => {
    const r = makers.shift()!()
    if (r instanceof Error) throw r
    return r
  })
  return f as unknown as typeof fetch & typeof f
}

describe("putWithRetry", () => {
  it("succeeds on the first try", async () => {
    const f = seq(() => new Response(null, { status: 200 }))
    await putWithRetry("u", blob, f)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("retries once after a network error", async () => {
    const f = seq(() => new Error("net"), () => new Response(null, { status: 200 }))
    await putWithRetry("u", blob, f)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("counts the retry's 'already exists' answer as success (the first PUT stored the file)", async () => {
    const f = seq(() => new Error("response lost"), dup)
    await putWithRetry("u", blob, f)
    const g = seq(() => new Response(null, { status: 500 }), () => new Response(null, { status: 409 }))
    await putWithRetry("u", blob, g)
  })

  it("does not accept any other failure", async () => {
    await expect(putWithRetry("u", blob, seq(fail(500), fail(500)))).rejects.toThrow("upload 500")
    await expect(putWithRetry("u", blob, seq(fail(500), fail(400)))).rejects.toThrow("upload 400")
    await expect(putWithRetry("u", blob, seq(fail(500), fail(403)))).rejects.toThrow("upload 403")
    await expect(putWithRetry("u", blob, seq(() => new Error("a"), () => new Error("b")))).rejects.toThrow("b")
  })

  it("does not skip a duplicate answer on the first try", async () => {
    const f = seq(dup, () => new Response(null, { status: 200 }))
    await putWithRetry("u", blob, f)
    expect(f).toHaveBeenCalledTimes(2)
  })
})
