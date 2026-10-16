import { fetchTikTokStats, refreshTikTok, type TikTokApp } from "./tiktok.js";

// Social media numbers for the dashboard, fetched from each platform's own API.
// An account with no key set shows as "Not connected", and one whose API call
// fails shows the reason, so the page never shows a guessed number.
// Results are kept for a few minutes so refreshing the page doesn't use up
// the platforms' request limits.

export interface SocialStat {
  label: string;
  value: number;
  note?: string;
}

export interface SocialAccount {
  name: string;
  url: string;
  status: "live" | "not_connected" | "error";
  stats: SocialStat[];
  /** What it takes to connect it (when not connected). */
  needs?: string;
  /** Why loading failed (when status is "error"), or a note about missing numbers. */
  problem?: string;
}

export interface SocialsSource {
  load(now: Date): Promise<SocialAccount[]>;
}

export interface SocialsOptions {
  /** Meta (Instagram and Facebook): a system user token with access to the Facebook Page. */
  meta?: { token: string; pageId: string; graphApiVersion: string };
  /** YouTube: an API key and the channel's handle (without the @). */
  youtube?: { apiKey: string; handle: string };
  /** TikTok: the developer app's keys, plus the refresh key from connecting (see tiktok.ts). */
  tiktok?: TikTokApp & { refreshToken?: string };
  fetch?: typeof fetch;
  /** How long to keep results, in milliseconds. */
  cacheMs?: number;
}

const INSTAGRAM_URL = "https://instagram.com/yarnoga";
const FACEBOOK_URL = "https://facebook.com/useyarnoga";
const TIKTOK_URL = "https://tiktok.com/@yarnoga";
const TIKTOK_NEEDS = "TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET on Railway, then the connect button (see docs/DASHBOARD.md)";

const DAY_S = 24 * 60 * 60;

class ApiError extends Error {}

export function createSocials(opts: SocialsOptions): SocialsSource {
  const fetchFn = opts.fetch ?? fetch;
  const cacheMs = opts.cacheMs ?? 10 * 60 * 1000;
  let cached: { at: number; accounts: SocialAccount[] } | undefined;
  const secrets = [opts.meta?.token, opts.youtube?.apiKey, opts.tiktok?.clientSecret, opts.tiktok?.refreshToken].filter(
    (s): s is string => Boolean(s),
  );
  // TikTok may hand out a new refresh key each time; keep using the newest.
  let tiktokRefresh = opts.tiktok?.refreshToken;

  // Never let a key or token end up on the page inside an error message.
  function reason(err: unknown): string {
    let text = err instanceof Error ? err.message : String(err);
    for (const secret of secrets) text = text.split(secret).join("***");
    return text;
  }

  async function getJson(url: string): Promise<any> {
    const res = await fetchFn(url);
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      throw new ApiError(body?.error?.message ?? `request failed with status ${res.status}`);
    }
    return body;
  }

  async function loadMeta(now: Date): Promise<SocialAccount[]> {
    const meta = opts.meta;
    const metaNeeds = "META_SOCIAL_TOKEN and FACEBOOK_PAGE_ID on Railway (see docs/DASHBOARD.md)";
    if (!meta) {
      return [
        { name: "Instagram", url: INSTAGRAM_URL, status: "not_connected", stats: [], needs: metaNeeds },
        { name: "Facebook", url: FACEBOOK_URL, status: "not_connected", stats: [], needs: metaNeeds },
      ];
    }
    const graph = `https://graph.facebook.com/${meta.graphApiVersion}`;

    let page: any;
    try {
      page = await getJson(
        `${graph}/${encodeURIComponent(meta.pageId)}?fields=access_token,followers_count,fan_count,instagram_business_account&access_token=${encodeURIComponent(meta.token)}`,
      );
    } catch (err) {
      const problem = `Meta said: ${reason(err)}`;
      return [
        { name: "Instagram", url: INSTAGRAM_URL, status: "error", stats: [], problem },
        { name: "Facebook", url: FACEBOOK_URL, status: "error", stats: [], problem },
      ];
    }
    // The Page's own token can read things the system user token can't (insights).
    const pageToken: string = page.access_token ?? meta.token;
    if (page.access_token) secrets.push(page.access_token);

    const facebook: SocialAccount = {
      name: "Facebook",
      url: FACEBOOK_URL,
      status: "live",
      stats: [
        ...(typeof page.followers_count === "number" ? [{ label: "Followers", value: page.followers_count }] : []),
        ...(typeof page.fan_count === "number" ? [{ label: "Page likes", value: page.fan_count }] : []),
      ],
    };

    const igId: string | undefined = page.instagram_business_account?.id;
    let instagram: SocialAccount;
    if (!igId) {
      instagram = {
        name: "Instagram",
        url: INSTAGRAM_URL,
        status: "error",
        stats: [],
        problem: "Instagram isn't linked to the Facebook Page yet (it must be a Business or Creator account).",
      };
    } else {
      try {
        const ig = await getJson(
          `${graph}/${igId}?fields=followers_count,media_count&access_token=${encodeURIComponent(pageToken)}`,
        );
        instagram = {
          name: "Instagram",
          url: INSTAGRAM_URL,
          status: "live",
          stats: [
            { label: "Followers", value: Number(ig.followers_count ?? 0) },
            { label: "Posts", value: Number(ig.media_count ?? 0) },
          ],
        };
        try {
          const until = Math.floor(now.getTime() / 1000);
          const since = until - 28 * DAY_S;
          const insights = await getJson(
            `${graph}/${igId}/insights?metric=reach,accounts_engaged&period=day&metric_type=total_value&since=${since}&until=${until}&access_token=${encodeURIComponent(pageToken)}`,
          );
          const labels: Record<string, string> = { reach: "Accounts reached", accounts_engaged: "Accounts engaged" };
          for (const row of insights.data ?? []) {
            const value = row?.total_value?.value;
            if (labels[row?.name] && typeof value === "number") {
              instagram.stats.push({ label: labels[row.name], value, note: "last 28 days" });
            }
          }
        } catch (err) {
          instagram.problem = `Reach numbers unavailable: ${reason(err)}`;
        }
      } catch (err) {
        instagram = { name: "Instagram", url: INSTAGRAM_URL, status: "error", stats: [], problem: `Meta said: ${reason(err)}` };
      }
    }
    return [instagram, facebook];
  }

  async function loadYouTube(): Promise<SocialAccount> {
    const yt = opts.youtube;
    const url = `https://youtube.com/@${yt?.handle ?? "yarnoga"}`;
    if (!yt) {
      return { name: "YouTube", url, status: "not_connected", stats: [], needs: "YOUTUBE_API_KEY on Railway (see docs/DASHBOARD.md)" };
    }
    try {
      const body = await getJson(
        `https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle=${encodeURIComponent(yt.handle)}&key=${encodeURIComponent(yt.apiKey)}`,
      );
      const s = body.items?.[0]?.statistics;
      if (!s) throw new ApiError(`no channel found for @${yt.handle}`);
      return {
        name: "YouTube",
        url,
        status: "live",
        stats: [
          ...(s.hiddenSubscriberCount ? [] : [{ label: "Subscribers", value: Number(s.subscriberCount ?? 0) }]),
          { label: "Total views", value: Number(s.viewCount ?? 0) },
          { label: "Videos", value: Number(s.videoCount ?? 0) },
        ],
      };
    } catch (err) {
      return { name: "YouTube", url, status: "error", stats: [], problem: `YouTube said: ${reason(err)}` };
    }
  }

  async function loadTikTok(): Promise<SocialAccount> {
    const tt = opts.tiktok;
    if (!tt) return { name: "TikTok", url: TIKTOK_URL, status: "not_connected", stats: [], needs: TIKTOK_NEEDS };
    if (!tiktokRefresh) {
      return {
        name: "TikTok",
        url: TIKTOK_URL,
        status: "not_connected",
        stats: [],
        needs: "one sign-in: open /dashboard/tiktok/connect and follow the steps",
      };
    }
    try {
      const tokens = await refreshTikTok(fetchFn, tt, tiktokRefresh);
      secrets.push(tokens.accessToken);
      if (tokens.refreshToken) {
        secrets.push(tokens.refreshToken);
        tiktokRefresh = tokens.refreshToken;
      }
      const s = await fetchTikTokStats(fetchFn, tokens.accessToken);
      return {
        name: "TikTok",
        url: TIKTOK_URL,
        status: "live",
        stats: [
          { label: "Followers", value: s.followers },
          { label: "Likes", value: s.likes },
          { label: "Videos", value: s.videos },
        ],
      };
    } catch (err) {
      return { name: "TikTok", url: TIKTOK_URL, status: "error", stats: [], problem: `TikTok said: ${reason(err)}` };
    }
  }

  return {
    async load(now) {
      if (cached && now.getTime() - cached.at < cacheMs) return cached.accounts;
      const [[instagram, facebook], tiktok, youtube] = await Promise.all([loadMeta(now), loadTikTok(), loadYouTube()]);
      const accounts: SocialAccount[] = [
        instagram,
        facebook,
        tiktok,
        youtube,
      ];
      cached = { at: now.getTime(), accounts };
      return accounts;
    },
  };
}
