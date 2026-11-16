// Runs against the LOCAL Supabase stack (the authorised call sweeps expired attempts).
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const SECRET = "test-cron-secret-value";

function call(authorization?: string) {
  return GET(
    new Request("http://localhost/api/cron/sweep", {
      headers: authorization ? { authorization } : {},
    }),
  );
}

describe("GET /api/cron/sweep", () => {
  const original = process.env.CRON_SECRET;
  afterEach(() => {
    process.env.CRON_SECRET = original;
  });

  it("rejects a request without the Bearer secret", async () => {
    process.env.CRON_SECRET = SECRET;
    expect((await call()).status).toBe(401);
    expect((await call(`Bearer ${SECRET}x`)).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
  });

  it("rejects every request when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call("Bearer undefined")).status).toBe(401);
  });

  it("sweeps with the correct secret", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).submitted).toBe("number");
  });
});
