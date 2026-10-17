import { describe, it, expect, vi } from "vitest";
import { FxEmbedClient } from "../src/fxembed-client";
import { USER_ID, USERNAME } from "../src/tibo/state";
const post = (id: string, extra = {}) => ({ type: "status", id, author: { id: USER_ID },
  replying_to: null, reposted_by: null, text: "Hello world, no keywords.",
  created_timestamp: 1792217208, ...extra });
const page = (results: unknown[]) => Response.json({ code: 200, results, cursor: { bottom: null } });
describe("standalone originals from FxEmbed", () => {
  it("includes arbitrary originals; excludes replies, reposts, quotes and deleted quotes", async () => {
    const fetcher = vi.fn().mockResolvedValue(page([
      post("101"), post("102", { replying_to: { status: "1" } }),
      post("103", { reposted_by: { id: USER_ID } }), post("104", { quote: post("1") }),
      post("105", { quote: { type: "tombstone", reason: "deleted" } }),
      post("106", { is_quote_status: true }), post("107", { author: { id: "99" } }),
    ]));
    const result = await new FxEmbedClient(fetcher).getPosts({ userId: USER_ID,
      username: USERNAME, sinceId: "100", excludeReplies: true, originalOnly: true });
    expect(result.posts.map(p => p.id)).toEqual(["101"]);
    expect(result.newestId).toBe("106");
    expect((fetcher.mock.calls[0][0] as URL).searchParams.has("with_replies")).toBe(false);
  });
  it("preserves all returned long text and marks uncertain completeness", async () => {
    const text = "原文 & < >\n" + "No translation. ".repeat(1000);
    const client = new FxEmbedClient(vi.fn().mockResolvedValue(page([
      post("101", { text: "preview", raw_text: { text }, is_note_tweet: true }),
      post("102", { truncated: true }),
    ])));
    const { posts } = await client.getPosts({ userId: USER_ID, username: USERNAME, originalOnly: true });
    expect(posts[0].text).toBe(text);
    expect(posts[0].textNotice).toContain("未提供全文完整性证明");
    expect(posts[1].textNotice).toContain("可能不完整");
  });
  it("fails instead of guessing when reply classification is absent", async () => {
    const raw: Record<string, unknown> = post("101"); delete raw.replying_to;
    const client = new FxEmbedClient(vi.fn().mockResolvedValue(page([raw])));
    await expect(client.getPosts({ userId: USER_ID, username: USERNAME, originalOnly: true }))
      .rejects.toThrow("classification unavailable");
  });
});

