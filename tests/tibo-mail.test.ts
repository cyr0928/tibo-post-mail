import { describe, it, expect, vi, beforeEach } from "vitest";
const { sendMail, createTransport } = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));
import { createQqMailer, renderPostMail } from "../src/tibo/mail";
beforeEach(() => { sendMail.mockReset().mockResolvedValue({ accepted: ["recipient"], rejected: [] });
  createTransport.mockReset().mockReturnValue({ sendMail }); });
const env = { QQ_EMAIL: "10000@qq.com", QQ_SMTP_AUTH_CODE: "test-only-do-not-use" };
describe("QQ SMTP mail", () => {
  it("uses encrypted QQ SMTP, sends to the same mailbox, and labels the test", async () => {
    await createQqMailer(env).sendTest("123");
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.qq.com", port: 465, secure: true,
      auth: { user: env.QQ_EMAIL, pass: env.QQ_SMTP_AUTH_CODE }, logger: false, debug: false }));
    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: env.QQ_EMAIL, to: env.QQ_EMAIL, subject: "【测试】Tibo 新帖邮件提醒" });
    expect(sendMail.mock.calls[0][0].text).not.toContain(env.QQ_SMTP_AUTH_CODE);
  });
  it("preserves long original text, Beijing time, original URL and media-only notices", () => {
    const text = "Original\n" + "Unmodified. ".repeat(1000);
    const mail = renderPostMail({ id: "101", text, createdAt: "2026-10-17T01:02:03Z",
      url: "https://x.com/thsottiaux/status/101", media: [{ type: "photo", mediaKey: "m", url: "https://example.invalid/p.jpg", previewImageUrl: null, altText: null }] });
    expect(mail).toContain(text); expect(mail).toContain("09:02:03 北京时间");
    expect(mail).toContain("https://x.com/thsottiaux/status/101");
    expect(mail).toContain("1 个图片/视频/GIF"); expect(mail).toContain("可能漏帖");
    expect(mail).not.toContain("https://example.invalid/p.jpg");
  });
  it("redacts SMTP responses and rejects missing secrets or rejected recipients", async () => {
    expect(() => createQqMailer({})).toThrow("Actions Secrets");
    sendMail.mockRejectedValueOnce(new Error("private auth/server detail"));
    await expect(createQqMailer(env).sendTest("1")).rejects.toThrow(/^QQ SMTP delivery failed; credentials and server response redacted$/);
    sendMail.mockResolvedValueOnce({ accepted: [], rejected: [env.QQ_EMAIL] });
    await expect(createQqMailer(env).sendTest("2")).rejects.toThrow("QQ SMTP delivery failed");
  });
});
