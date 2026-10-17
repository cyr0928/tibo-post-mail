import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTiboMonitor } from "../src/tibo/monitor";
import { emptyTiboState, saveTiboState, loadTiboState, USER_ID, type TiboState } from "../src/tibo/state";
const now = () => new Date("2026-10-17T08:00:00Z");
const post = (id: string, createdAt = "2026-10-17T08:01:00Z") => ({ id, text: "Just an ordinary new post.",
  createdAt, url: `https://x.com/thsottiaux/status/${id}`, media: [] });
const initialized = (): TiboState => ({ ...emptyTiboState(), initializedAt: now().toISOString(), sinceId: "100" });
const source = () => ({ resolveUserId: vi.fn().mockResolvedValue(USER_ID),
  getPosts: vi.fn().mockResolvedValue({ posts: [post("101")], newestId: "101" as string | null }) });
describe("original-post durable delivery", () => {
  it("first success only establishes baseline; failed or empty read does not initialize", async () => {
    const s = emptyTiboState(), api = source(), send = vi.fn(), checkpoint = vi.fn();
    api.getPosts.mockRejectedValueOnce(new Error("outage"));
    await expect(runTiboMonitor(s, { source: api, send, checkpoint, now })).rejects.toThrow("Source");
    expect(s.initializedAt).toBeNull(); expect(checkpoint).not.toHaveBeenCalled();
    await runTiboMonitor(s, { source: api, send, checkpoint, now });
    expect(s.initializedAt).toBe(now().toISOString()); expect(s.sinceId).toBe("101");
    expect(send).not.toHaveBeenCalled(); expect(s.pending).toEqual([]);
    const empty = emptyTiboState(); api.getPosts.mockResolvedValue({ posts: [], newestId: null });
    await expect(runTiboMonitor(empty, { source: api, send, checkpoint, now })).rejects.toThrow();
    expect(empty.initializedAt).toBeNull();
  });
  it("sends an ordinary original once across fresh state reloads; refuses historical arrivals", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tibo-"));
    try {
      const path = join(dir, "state.json"), api = source(), send = vi.fn();
      const checkpoint = (s: TiboState) => saveTiboState(path, s);
      await runTiboMonitor(initialized(), { source: api, send, checkpoint, now });
      await runTiboMonitor(await loadTiboState(path), { source: api, send, checkpoint, now });
      expect(send).toHaveBeenCalledTimes(1);
      api.getPosts.mockResolvedValue({ posts: [post("102", "2026-10-16T00:00:00Z")], newestId: "102" });
      await runTiboMonitor(await loadTiboState(path), { source: api, send, checkpoint, now });
      expect(send).toHaveBeenCalledTimes(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("keeps failed mail queued and retries after restart, even during source outage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tibo-retry-"));
    try {
      const path = join(dir, "state.json"), api = source();
      const send = vi.fn().mockRejectedValueOnce(new Error("do-not-log-auth-code")).mockResolvedValue(undefined);
      const checkpoint = (s: TiboState) => saveTiboState(path, s);
      await expect(runTiboMonitor(initialized(), { source: api, send, checkpoint, now })).rejects.toThrow("SMTP");
      const failed = await loadTiboState(path);
      expect(failed.sent).toEqual({}); expect(failed.pending[0].status).toBe("pending");
      expect(failed.sinceId).toBe("101");
      api.getPosts.mockRejectedValue(new Error("outage"));
      await expect(runTiboMonitor(failed, { source: api, send, checkpoint, now })).rejects.toThrow("Source");
      expect(send).toHaveBeenCalledTimes(2);
      const recovered = await loadTiboState(path);
      expect(recovered.pending).toEqual([]); expect(recovered.sent["101"]).toBeTruthy();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("never sends before durable queue commit or marks success before SMTP accepts", async () => {
    const send = vi.fn(), api = source(), state = initialized();
    await expect(runTiboMonitor(state, { source: api, send,
      checkpoint: vi.fn().mockRejectedValue(new Error("remote write failed")), now })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled(); expect(state.sent).toEqual({});
    const checkpoint = vi.fn().mockResolvedValue(undefined);
    const inspect = vi.fn(async () => { expect(state.sent).toEqual({}); expect(state.pending[0].status).toBe("sending"); });
    await runTiboMonitor(state, { source: api, send: inspect, checkpoint, now });
    expect(checkpoint).toHaveBeenCalledTimes(3); expect(state.sent["101"]).toBeTruthy();
  });
  it("stops when the handle resolves to a different numeric identity", async () => {
    const api = source(); api.resolveUserId.mockResolvedValue("999");
    const send = vi.fn();
    await expect(runTiboMonitor(emptyTiboState(), { source: api, send, checkpoint: vi.fn(), now })).rejects.toThrow();
    expect(api.getPosts).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
});

