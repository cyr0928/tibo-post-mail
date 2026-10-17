import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCheckpoint } from "../src/tibo/checkpoint";
import { emptyTiboState, loadTiboState } from "../src/tibo/state";
const run = promisify(execFile);
describe("durable Git state across runners", () => {
  it("pushes a queue to a remote and restores it in a clean checkout; preserves sent records", async () => {
    const root = await mkdtemp(join(tmpdir(), "tibo-git-"));
    const git = (cwd: string, ...args: string[]) => run("git", args, { cwd });
    try {
      const remote = join(root, "remote.git"), first = join(root, "first"), fresh = join(root, "fresh");
      await git(root, "init", "--bare", remote); await mkdir(first);
      await git(first, "init", "-b", "monitor-state");
      await git(first, "config", "user.name", "test"); await git(first, "config", "user.email", "test@example.invalid");
      await git(first, "remote", "add", "origin", remote);
      const state = { ...emptyTiboState(), initializedAt: "2026-10-17T08:00:00Z", sinceId: "100",
        pending: [{ id: "101", post: { id: "101", text: "Hello", createdAt: "2026-10-17T08:01:00Z",
          url: "https://x.com/thsottiaux/status/101", media: [] }, attempts: 0, status: "pending" as const }] };
      await createCheckpoint(join(first, "state.json"), true)(state);
      await git(root, "clone", "--branch", "monitor-state", remote, fresh);
      const restored = await loadTiboState(join(fresh, "state.json"));
      expect(restored.pending[0].id).toBe("101"); expect(restored.sent).toEqual({});
      restored.sent["101"] = "2026-10-17T08:02:00Z"; restored.pending = [];
      await git(fresh, "config", "user.name", "test"); await git(fresh, "config", "user.email", "test@example.invalid");
      await createCheckpoint(join(fresh, "state.json"), true)(restored);
      await git(first, "pull", "--ff-only", "origin", "monitor-state");
      expect((await loadTiboState(join(first, "state.json"))).sent["101"]).toBeTruthy();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30000);
  it("refuses missing, malformed or mismatched state instead of reinitializing", async () => {
    const root = await mkdtemp(join(tmpdir(), "tibo-bad-state-"));
    try {
      const path = join(root, "state.json");
      await expect(loadTiboState(path)).rejects.toThrow();
      await writeFile(path, "{}"); await expect(loadTiboState(path)).rejects.toThrow("Invalid");
      await writeFile(path, JSON.stringify({ ...emptyTiboState(), userId: "999" }));
      await expect(loadTiboState(path)).rejects.toThrow("Invalid");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

