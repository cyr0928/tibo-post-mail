import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { XPost } from "../types";

export const USERNAME = "thsottiaux";
export const USER_ID = "1953337039510003712";
export const SOURCE_NOTICE = "免费 FxEmbed 来源可能漏帖、缓存或失效；无法保证获得所有帖子或所有长帖的全文。此通知不翻译、不概括、不主动截断。";
export type Delivery = { id: string; post: XPost; attempts: number; status: "pending" | "sending"; lastAttemptAt?: string };
export type TiboState = {
  schemaVersion: 1; username: typeof USERNAME; userId: typeof USER_ID;
  initializedAt: string | null; sinceId: string | null; lastSuccessAt: string | null;
  sent: Record<string, string>; pending: Delivery[];
  testEmailSentAt?: string;
};
export const emptyTiboState = (): TiboState => ({
  schemaVersion: 1, username: USERNAME, userId: USER_ID,
  initializedAt: null, sinceId: null, lastSuccessAt: null, sent: {}, pending: [],
});
const numeric = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
export async function loadTiboState(path: string): Promise<TiboState> {
  // Production always checks out an existing state file. Missing/corrupt state
  // must stop the run rather than silently creating another historical baseline.
  const s = JSON.parse(await readFile(path, "utf8")) as TiboState;
  if (s.schemaVersion !== 1 || s.username !== USERNAME || s.userId !== USER_ID ||
      !(s.initializedAt === null || date(s.initializedAt)) ||
      !(s.sinceId === null || numeric(s.sinceId)) ||
      (s.initializedAt !== null && !numeric(s.sinceId)) ||
      (s.initializedAt === null && s.sinceId !== null) ||
      !(s.lastSuccessAt === null || date(s.lastSuccessAt)) ||
      !s.sent || typeof s.sent !== "object" || Array.isArray(s.sent) ||
      Object.entries(s.sent).some(([id, at]) => !numeric(id) || !date(at)) ||
      !Array.isArray(s.pending) || s.pending.some(p => !numeric(p.id) ||
        p.post?.id !== p.id || typeof p.post?.text !== "string" ||
        !date(p.post.createdAt) || !Array.isArray(p.post.media) ||
        p.post.url !== `https://x.com/${USERNAME}/status/${p.id}` ||
        !Number.isSafeInteger(p.attempts) || p.attempts < 0 ||
        !["pending", "sending"].includes(p.status)) ||
      new Set(s.pending.map(p => p.id)).size !== s.pending.length)
    throw new Error("Invalid durable state; restore monitor-state before retrying");
  return s;
}
export async function saveTiboState(path: string, state: TiboState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(`${path}.tmp`, path);
}

