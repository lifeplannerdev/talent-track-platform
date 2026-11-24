import { describe, expect, it } from "vitest";
import { buildInviteMail } from "./invite-template";

const link = "https://app.example.com/set-password?token_hash=abc123&type=recovery";

describe("buildInviteMail", () => {
  const mail = buildInviteMail({ fullName: "Anu Menon", username: "anu.menon", link });

  it("has the username and link in both html and text", () => {
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain("anu.menon");
      expect(body).toContain("Anu Menon");
    }
    expect(mail.text).toContain(link);
    expect(mail.html).toContain("token_hash=abc123&amp;type=recovery");
  });

  it("uses the exact product name and F.L.A.G., with no password", () => {
    expect(mail.subject).toContain("Talent Track Platform");
    expect(mail.html).toContain("Talent Track Platform");
    expect(mail.html).toContain("F.L.A.G.");
    expect(mail.html).toContain("#2346a0");
    expect(mail.html.toLowerCase()).not.toMatch(/password:|your password is/);
    expect(mail.text.toLowerCase()).not.toMatch(/password:|your password is/);
  });

  it("escapes the name and username in html", () => {
    const evil = buildInviteMail({ fullName: `<script>alert("x")</script> & Co`, username: `a"><img src=x>`, link });
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).not.toContain("<img src=x>");
    expect(evil.html).toContain("&lt;script&gt;");
    expect(evil.html).toContain("&amp; Co");
    expect(evil.html).toContain("&quot;&gt;&lt;img");
  });

  it("escapes a hostile link in the href", () => {
    const m = buildInviteMail({ fullName: "A", username: "a", link: `https://x.test/?a=1"><b>` });
    expect(m.html).not.toContain(`"><b>`);
  });

  it("leaves `to` empty for the caller to set", () => {
    expect(mail.to).toBe("");
  });
});
