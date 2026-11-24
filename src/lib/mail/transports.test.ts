import { afterEach, describe, expect, it, vi } from "vitest";
import { logTransport, resendTransport } from "./transports";

const message = {
  to: "student@example.com",
  subject: "Hello",
  text: "text body https://app.test/set-password?token_hash=SECRETTOKEN",
  html: "<p>html body SECRETTOKEN</p>",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("logTransport", () => {
  it("returns ok and logs nothing containing the body or link", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
    ];
    expect(await logTransport(message)).toEqual({ ok: true });
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain("SECRETTOKEN");
    expect(logged).not.toContain("student@");
  });
});

describe("resendTransport", () => {
  it("posts the right payload with a Bearer key", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_key");
    vi.stubEnv("MAIL_FROM", "Talent Track Platform <no-reply@mail.example.com>");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    expect(await resendTransport(message)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_key");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      from: "Talent Track Platform <no-reply@mail.example.com>",
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  });

  it("maps a non-2xx response to ok false without logging the body", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_key");
    vi.stubEnv("MAIL_FROM", "a@b.c");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resendTransport(message)).toEqual({ ok: false });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRETTOKEN");
  });

  it("gives up on a fetch that never resolves and passes an abort signal", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_key");
    vi.stubEnv("MAIL_FROM", "a@b.c");
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
        ),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      const pending = resendTransport(message);
      await vi.advanceTimersByTimeAsync(8001);
      expect(await pending).toEqual({ ok: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps a thrown fetch to ok false", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_key");
    vi.stubEnv("MAIL_FROM", "a@b.c");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network SECRETTOKEN")));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resendTransport(message)).toEqual({ ok: false });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRETTOKEN");
  });

  it.each(["RESEND_API_KEY", "MAIL_FROM"])("returns ok false and names %s when it is missing", async (missing) => {
    vi.stubEnv("RESEND_API_KEY", missing === "RESEND_API_KEY" ? "" : "re_secret_value");
    vi.stubEnv("MAIL_FROM", missing === "MAIL_FROM" ? "" : "from@secret.example");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resendTransport(message)).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0].join(" "));
    expect(line).toContain(missing);
    expect(line).not.toContain("re_secret_value");
    expect(line).not.toContain("secret.example");
  });
});
