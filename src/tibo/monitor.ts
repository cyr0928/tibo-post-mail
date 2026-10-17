import type { PostSource } from "../post-source";
import type { XPost } from "../types";
import { USERNAME, USER_ID, type TiboState } from "./state";

export type MonitorDependencies = {
  source: PostSource; checkpoint: (state: TiboState) => Promise<void>;
  send: (post: XPost) => Promise<void>; now?: () => Date;
};
export async function collect(state: TiboState, deps: MonitorDependencies): Promise<void> {
  const resolved = await deps.source.resolveUserId(USERNAME);
  if (resolved !== USER_ID) throw new Error("Account identity mismatch; stopped without advancing state");
  const bootstrap = state.initializedAt === null;
  const fetched = await deps.source.getPosts({ userId: USER_ID, username: USERNAME,
    sinceId: state.sinceId, bootstrap, excludeReplies: true, originalOnly: true });
  const now = (deps.now ?? (() => new Date()))().toISOString();
  if (bootstrap) {
    if (!fetched.newestId || fetched.posts.length === 0)
      throw new Error("Baseline read did not contain an original post; initialization refused");
    // Do not create historical queue entries. This successful read defines activation.
    state.sinceId = fetched.newestId;
    state.initializedAt = now;
  } else {
    for (const post of [...fetched.posts].sort((a,b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1)) {
      if (!post.createdAt || !Number.isFinite(Date.parse(post.createdAt)))
        throw new Error("Post time unavailable; checkpoint not advanced");
      if (Date.parse(post.createdAt) <= Date.parse(state.initializedAt!) ||
          (state.sinceId && BigInt(post.id) <= BigInt(state.sinceId)) ||
          state.sent[post.id] || state.pending.some(p => p.id === post.id)) continue;
      state.pending.push({ id: post.id, post, attempts: 0, status: "pending" });
    }
    if (fetched.newestId && (!state.sinceId || BigInt(fetched.newestId) > BigInt(state.sinceId)))
      state.sinceId = fetched.newestId;
  }
  state.lastSuccessAt = now;
  // The entire cursor + queue transition is durable before sending any email.
  await deps.checkpoint(state);
}
export async function deliver(state: TiboState, deps: MonitorDependencies): Promise<void> {
  let failed = false;
  for (const item of [...state.pending]) {
    if (state.sent[item.id]) {
      state.pending = state.pending.filter(p => p.id !== item.id);
      await deps.checkpoint(state);
      continue;
    }
    item.attempts++;
    item.status = "sending";
    item.lastAttemptAt = (deps.now ?? (() => new Date()))().toISOString();
    await deps.checkpoint(state);
    try { await deps.send(item.post); }
    catch {
      item.status = "pending";
      await deps.checkpoint(state);
      failed = true;
      continue;
    }
    // Never mark success before SMTP accepts the message. Abort immediately if
    // the following remote checkpoint fails. SMTP cannot promise exactly-once
    // across an acceptance/commit crash; stable Message-ID helps investigation.
    state.sent[item.id] = (deps.now ?? (() => new Date()))().toISOString();
    state.pending = state.pending.filter(p => p.id !== item.id);
    await deps.checkpoint(state);
  }
  if (failed) throw new Error("SMTP delivery failed; unsent messages remain queued for the next run");
}
export async function runTiboMonitor(state: TiboState, deps: MonitorDependencies): Promise<void> {
  let collectionFailed = false;
  const draft = structuredClone(state);
  try { await collect(draft, { ...deps, checkpoint: async () => {} }); }
  catch { collectionFailed = true; }
  if (!collectionFailed) {
    // Commit failures are fatal and must not fall through into mail delivery.
    await deps.checkpoint(draft);
    Object.assign(state, draft);
  }
  // Previously committed queue entries remain deliverable during a source outage.
  await deliver(state, deps);
  if (collectionFailed) throw new Error("Source collection or checkpoint failed; baseline/cursor not confirmed");
}

