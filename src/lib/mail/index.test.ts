import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMail } from "./index";

const message = {
  to: "student@example.com",
  subject: "Hello",
  text: "body https://app.test/x?token_hash=SECRETTOKEN",
  html: "<p>SECRETTOKEN</p>",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function allLogs(spies: ReturnType<typeof vi.spyOn>[]) {
  return JSON.stringify(spies.flatMap((s) => s.mock.calls));
}

describe("sendMail", () => {
  it("defaults to the log transport outside production and never calls fetch", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MAIL_TRANSPORT", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const spies = [vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "info").mockImplementation(() => {})];
    expect(await sendMail(message)).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = allLogs(spies);
    expect(logged).toContain("example.com");
    expect(logged).not.toContain("SECRETTOKEN");
    expect(logged).not.toContain("student@");
  });

  it("uses resend when MAIL_TRANSPORT=resend", async () => {
    vi.stubEnv("MAIL_TRANSPORT", "resend");
    vi.stubEnv("RESEND_API_KEY", "k");
    vi.stubEnv("MAIL_FROM", "a@b.c");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const spies = [vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "info").mockImplementation(() => {})];
    expect(await sendMail(message)).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const logged = allLogs(spies);
    expect(logged).not.toContain("SECRETTOKEN");
    expect(logged).not.toContain("student@");
  });

  it("returns ok false for resend when config is missing", async () => {
    vi.stubEnv("MAIL_TRANSPORT", "resend");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("MAIL_FROM", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendMail(message)).toEqual({ ok: false });
  });

  it("never throws, even if the transport blows up", async () => {
    vi.stubEnv("MAIL_TRANSPORT", "resend");
    vi.stubEnv("RESEND_API_KEY", "k");
    vi.stubEnv("MAIL_FROM", "a@b.c");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendMail(message)).resolves.toEqual({ ok: false });
  });

  it("returns ok false for an unknown transport name or a malformed recipient", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("MAIL_TRANSPORT", "carrier-pigeon");
    expect(await sendMail(message)).toEqual({ ok: false });
    vi.stubEnv("MAIL_TRANSPORT", "log");
    expect(await sendMail({ ...message, to: "not-an-email" })).toEqual({ ok: false });
  });

  it("defaults to no sending (ok false) in production when MAIL_TRANSPORT is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MAIL_TRANSPORT", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendMail(message)).toEqual({ ok: false });
  });
});
