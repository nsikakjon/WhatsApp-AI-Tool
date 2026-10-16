// Pulls new comments out of an Instagram webhook. Meta sends a "comments"
// change for every comment on the account's posts, including our own replies,
// so those are left out here to stop the bot answering itself.

export interface IncomingComment {
  commentId: string;
  mediaId?: string;
  fromId?: string;
  username?: string;
  text: string;
}

export function extractComments(payload: unknown, ownAccountId: string): IncomingComment[] {
  const p = payload as any;
  if (p?.object !== "instagram" || !Array.isArray(p.entry)) return [];
  const out: IncomingComment[] = [];
  for (const entry of p.entry) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== "comments") continue;
      const v = change.value ?? {};
      if (typeof v.id !== "string" || !v.id) continue;
      const fromId = v.from?.id != null ? String(v.from.id) : undefined;
      // Our own comments (including the public replies we post).
      if (fromId && (fromId === ownAccountId || fromId === String(entry.id))) continue;
      // Replies inside a comment thread: only top-level comments get an answer.
      if (v.parent_id) continue;
      out.push({
        commentId: v.id,
        mediaId: v.media?.id != null ? String(v.media.id) : undefined,
        fromId,
        username: typeof v.from?.username === "string" ? v.from.username : undefined,
        text: typeof v.text === "string" ? v.text : "",
      });
    }
  }
  return out;
}
