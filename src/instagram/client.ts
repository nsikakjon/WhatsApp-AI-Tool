// Talks to Instagram through Meta's Graph API (graph.instagram.com, the
// "Instagram API with Instagram Login"). Two things only: answer a comment
// in public, and send the commenter one private message about it.

export interface InstagramClient {
  /** Posts a public reply under a comment. */
  replyToComment(commentId: string, text: string): Promise<void>;
  /**
   * Sends the commenter a private message (Meta calls it a "private reply").
   * Instagram allows one per comment, within 7 days of the comment.
   */
  sendPrivateReply(commentId: string, text: string): Promise<void>;
}

export interface InstagramClientOptions {
  accountId: string;
  accessToken: string;
  graphApiVersion: string;
  fetch?: typeof fetch;
}

export function createInstagramClient(opts: InstagramClientOptions): InstagramClient {
  const doFetch = opts.fetch ?? fetch;
  const base = `https://graph.instagram.com/${opts.graphApiVersion}`;

  async function post(path: string, body: unknown) {
    const res = await doFetch(`${base}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      // Never put the token in an error message.
      const reason = String(data?.error?.message ?? `status ${res.status}`).split(opts.accessToken).join("***");
      throw new Error(`Instagram API ${path.split("/").pop()} failed: ${reason}`);
    }
  }

  return {
    async replyToComment(commentId, text) {
      await post(`${encodeURIComponent(commentId)}/replies`, { message: text });
    },
    async sendPrivateReply(commentId, text) {
      await post(`${encodeURIComponent(opts.accountId)}/messages`, {
        recipient: { comment_id: commentId },
        message: { text },
      });
    },
  };
}
