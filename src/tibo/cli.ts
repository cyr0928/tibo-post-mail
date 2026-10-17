import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { FxEmbedClient } from "../fxembed-client";
import { createCheckpoint } from "./checkpoint";
import { createQqMailer } from "./mail";
import { collect, runTiboMonitor } from "./monitor";
import { emptyTiboState, loadTiboState, SOURCE_NOTICE, type TiboState } from "./state";

const mode = process.argv[2] ?? "monitor";
const path = process.env.STATE_PATH ?? "runtime/state.json";
const source = new FxEmbedClient();
async function summary(state: TiboState, label: string) {
  const text = `${label}\n\nSource: FxEmbed; account: @thsottiaux; interval: 15 minutes.\n\n` +
    `Initialized at: ${state.initializedAt ?? "not enabled"}\n\n` +
    `Cursor: ${state.sinceId ?? "none"}; sent: ${Object.keys(state.sent).length}; pending: ${state.pending.length}.\n\n${SOURCE_NOTICE}\n`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
}
try {
  const state = await loadTiboState(path);
  if (mode === "verify") {
    const probe = emptyTiboState();
    await collect(probe, { source, checkpoint: async () => {}, send: async () => {} });
    await summary(state, "Live source probe passed; durable baseline unchanged; no email sent.");
  } else if (mode === "test-email") {
    const mailer = createQqMailer();
    await mailer.sendTest(process.env.GITHUB_RUN_ID ?? randomUUID());
    state.testEmailSentAt = new Date().toISOString();
    await createCheckpoint(path, process.env.STATE_GIT_SYNC === "true")(state);
    await summary(state, "TEST email accepted by QQ SMTP. Recipient confirmation is still required. Monitoring not enabled by this test.");
  } else if (["initialize", "monitor"].includes(mode)) {
    if (mode === "monitor" && !state.initializedAt)
      throw new Error("Not initialized; use initialize after confirming the TEST email arrived");
    if (mode === "initialize" && !state.testEmailSentAt)
      throw new Error("Send and confirm the TEST email before initialization");
    if (mode === "initialize" && state.initializedAt)
      throw new Error("Already initialized; use monitor, never reset the baseline");
    const mailer = createQqMailer();
    await runTiboMonitor(state, { source, send: mailer.sendPost,
      checkpoint: createCheckpoint(path, process.env.STATE_GIT_SYNC === "true") });
    await summary(state, mode === "initialize" ? "Baseline established successfully; historical email count: 0." : "Monitor completed.");
  } else throw new Error("Unsupported monitor operation");
} catch (error) {
  // Every boundary above replaces provider/SMTP/Git details with safe messages.
  console.error(error instanceof Error && /^(Configure |Account |Baseline |Source |SMTP |QQ SMTP |Durable |Not initialized|Send and confirm|Already initialized|Unsupported monitor)/.test(error.message)
    ? error.message : "Monitor failed; state was not confirmed. Inspect the failed step; no secrets are logged.");
  process.exitCode = 1;
}

