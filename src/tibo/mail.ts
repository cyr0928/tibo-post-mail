import nodemailer from "nodemailer";
import type { XPost } from "../types";
import { SOURCE_NOTICE, USERNAME } from "./state";

export function beijingTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23" }).format(new Date(value)) + " 北京时间 (UTC+8)";
}
export function renderPostMail(post: XPost): string {
  if (!post.createdAt) throw new Error("Publication time is required");
  const attachments = post.media.length
    ? `附件提示：原帖含 ${post.media.length} 个图片/视频/GIF 等媒体，请到原帖查看。`
    : "附件提示：来源未报告图片/视频附件；这不保证原帖没有附件。";
  return [ `Tibo @${USERNAME} 新原创帖`, `发布时间：${beijingTime(post.createdAt)}`,
    `原帖链接：${post.url}`, "", "以下为来源提供的原文：", "", post.text, "",
    attachments, ...(post.hasArticle ? ["文章提示：原帖附有 X Article，邮件正文不代表该文章全文，请查看原帖。"] : []),
    "", `正文完整性：${post.textNotice ?? "来源未提供全文完整性证明，无法确认是否为全文。"}`,
    `来源限制：${SOURCE_NOTICE}` ].join("\n");
}
export function createQqMailer(env: NodeJS.ProcessEnv = process.env) {
  const address = env.QQ_EMAIL?.trim();
  const authCode = env.QQ_SMTP_AUTH_CODE?.trim();
  if (!address || !/^[A-Za-z0-9._+-]+@qq\.com$/i.test(address) || !authCode)
    throw new Error("Configure QQ_EMAIL and QQ_SMTP_AUTH_CODE in Actions Secrets");
  const transport = nodemailer.createTransport({
    host: "smtp.qq.com", port: 465, secure: true,
    auth: { user: address, pass: authCode },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 40_000,
    logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true,
  });
  const send = async (subject: string, text: string, messageId: string) => {
    try {
      const result = await transport.sendMail({ from: address, to: address, subject,
        text, messageId, date: new Date(), headers: { "Auto-Submitted": "auto-generated" } });
      if (!result.accepted?.length || result.rejected?.length)
        throw new Error("SMTP recipient was not accepted");
    } catch { throw new Error("QQ SMTP delivery failed; credentials and server response redacted"); }
  };
  return {
    sendPost: (post: XPost) => send(`Tibo 新帖 · @${USERNAME}`, renderPostMail(post),
      `<tibo-${post.id}@tibo-post-mail.invalid>`),
    sendTest: (runId: string) => send("【测试】Tibo 新帖邮件提醒", [
      "这是一封测试邮件，不是 Tibo 新帖通知。", `测试时间：${beijingTime(new Date().toISOString())}`,
      "监测目标：Tibo @thsottiaux；每 15 分钟检查一次。",
      "只通知单独发布的原创新帖；回复、转发、引用帖不通知。",
      "图片/视频等仅提示，正文不翻译、不概括、不主动截断。", SOURCE_NOTICE,
      "请回到 Codex 确认收到此测试邮件。首次成功建立基线后才开始正式监测，不补发历史。",
    ].join("\n"), `<tibo-test-${runId.replace(/[^A-Za-z0-9-]/g, "")}@tibo-post-mail.invalid>`),
  };
}

