import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname } from "node:path";
import { saveTiboState, type TiboState } from "./state";
const execute = promisify(execFile);
export function createCheckpoint(path: string, remote: boolean) {
  return async (state: TiboState): Promise<void> => {
    await saveTiboState(path, state);
    if (!remote) return;
    const git = async (...args: string[]) => execute("git", args,
      { cwd: dirname(path), timeout: 45_000, maxBuffer: 1024 * 1024 });
    try {
      if ((await git("branch", "--show-current")).stdout.trim() !== "monitor-state")
        throw new Error("Unexpected state branch");
      await git("add", "--", "state.json");
      const changed = (await git("diff", "--cached", "--name-only")).stdout.trim();
      if (changed) await git("commit", "-m", "chore: checkpoint Tibo monitor state");
      // Retrying a successful push is harmless. Never rebase/overwrite another writer.
      let pushed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await git("push", "origin", "HEAD:refs/heads/monitor-state"); pushed = true; break; }
        catch { /* retry this same fast-forward commit */ }
      }
      if (!pushed) throw new Error("Remote state checkpoint failed");
    } catch { throw new Error("Durable Git checkpoint failed; mail processing stopped; inspect recovery artifact"); }
  };
}
