import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncomingComment } from "./parse.js";

// Remembers every comment the bot has dealt with, so a webhook Meta sends
// twice never gets two replies or two messages. Each comment moves from
// "working" to "done", or to "failed" if Instagram refused a step; a failed
// comment is tried again (only the steps not yet done) when Meta re-sends it.

export interface CommentProgress {
  privateReplySent: boolean;
  publicReplySent: boolean;
}

export interface InstagramCommentStore {
  /**
   * Takes charge of a comment. Returns what's already been done for it, or
   * null if it's finished or another request is working on it right now.
   */
  claim(comment: IncomingComment): Promise<CommentProgress | null>;
  markPrivateReplySent(commentId: string): Promise<void>;
  markPublicReplySent(commentId: string): Promise<void>;
  markDone(commentId: string): Promise<void>;
  markFailed(commentId: string, error: string): Promise<void>;
}

const UNIQUE_VIOLATION = "23505";
const TABLE = "instagram_comment_replies";

export function createSupabaseInstagramStore(db: SupabaseClient): InstagramCommentStore {
  async function update(commentId: string, fields: Record<string, unknown>) {
    const { error } = await db
      .from(TABLE)
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("comment_id", commentId);
    if (error) throw new Error(`instagram store update failed: ${error.message}`);
  }

  return {
    async claim(comment) {
      const { error } = await db.from(TABLE).insert({
        comment_id: comment.commentId,
        media_id: comment.mediaId ?? null,
        commenter_id: comment.fromId ?? null,
        commenter_username: comment.username ?? null,
        comment_text: comment.text,
      });
      if (!error) return { privateReplySent: false, publicReplySent: false };
      if (error.code !== UNIQUE_VIOLATION) throw new Error(`instagram store claim failed: ${error.message}`);

      // Seen before. Only pick it up again if the last try failed; the
      // "status = failed" condition makes sure just one request wins.
      const { data, error: retryError } = await db
        .from(TABLE)
        .update({ status: "working", updated_at: new Date().toISOString() })
        .eq("comment_id", comment.commentId)
        .eq("status", "failed")
        .select("private_reply_at, public_reply_at")
        .maybeSingle();
      if (retryError) throw new Error(`instagram store claim failed: ${retryError.message}`);
      if (!data) return null;
      return { privateReplySent: Boolean(data.private_reply_at), publicReplySent: Boolean(data.public_reply_at) };
    },
    async markPrivateReplySent(commentId) {
      await update(commentId, { private_reply_at: new Date().toISOString() });
    },
    async markPublicReplySent(commentId) {
      await update(commentId, { public_reply_at: new Date().toISOString() });
    },
    async markDone(commentId) {
      await update(commentId, { status: "done", error: null });
    },
    async markFailed(commentId, error) {
      await update(commentId, { status: "failed", error: error.slice(0, 500) });
    },
  };
}
