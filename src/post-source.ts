import type { XPost } from "./types";
export type GetPostsOptions = { userId: string; username: string; sinceId?: string | null; excludeReplies?: boolean; bootstrap?: boolean; originalOnly?: boolean };
export interface PostSource {
  resolveUserId(username: string): Promise<string>;
  getPosts(options: GetPostsOptions): Promise<{ posts: XPost[]; newestId: string | null; latestObservedPost?: XPost | null }>;
}

