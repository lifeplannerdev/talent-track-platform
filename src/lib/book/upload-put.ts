// One signed-URL PUT with a single retry (client side, pure around an injectable fetch).
// If the first attempt stored the file but its response was lost, the retry meets Storage's
// "already exists" answer (no upsert on signed uploads): for that file the upload did succeed.

/** Storage's duplicate answer: HTTP 409, or HTTP 400 whose JSON body says statusCode 409 / error Duplicate. */
export async function isDuplicateResponse(res: Pick<Response, "status" | "text">): Promise<boolean> {
  if (res.status === 409) return true
  if (res.status !== 400) return false
  try {
    const body = JSON.parse(await res.text()) as { statusCode?: string | number; error?: string }
    return String(body.statusCode) === "409" || body.error === "Duplicate"
  } catch {
    return false
  }
}

export async function putWithRetry(url: string, blob: Blob, doFetch: typeof fetch = fetch): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await doFetch(url, { method: "PUT", headers: { "content-type": "image/webp" }, body: blob })
      if (res.ok) return
      if (attempt >= 1) {
        if (await isDuplicateResponse(res)) return
        throw new Error(`upload ${res.status}`)
      }
    } catch (e) {
      if (attempt >= 1) throw e
    }
  }
}
