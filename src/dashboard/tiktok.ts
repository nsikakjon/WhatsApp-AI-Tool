// TikTok's sign-in and account numbers. TikTok only gives numbers to an app the
// account owner has signed in to, so the owner connects once from the dashboard
// (/dashboard/tiktok/connect) and pastes the key it shows into Railway as
// TIKTOK_REFRESH_TOKEN. That key lasts about a year.

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const USER_URL = "https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count,likes_count,video_count";
export const TIKTOK_SCOPES = "user.info.basic,user.info.stats";

export interface TikTokApp {
  clientKey: string;
  clientSecret: string;
}

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
}

export interface TikTokStats {
  followers: number;
  following: number;
  likes: number;
  videos: number;
}

/** The TikTok page the owner is sent to, to allow the dashboard to read their numbers. */
export function tiktokAuthorizeUrl(app: TikTokApp, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_key: app.clientKey,
    scope: TIKTOK_SCOPES,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(fetchFn: typeof fetch, form: Record<string, string>): Promise<TikTokTokens> {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `TikTok sign-in failed with status ${res.status}`);
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

/** Swaps the one-time code TikTok sends back after sign-in for long-lived keys. */
export function exchangeTikTokCode(fetchFn: typeof fetch, app: TikTokApp, code: string, redirectUri: string) {
  return tokenRequest(fetchFn, {
    client_key: app.clientKey,
    client_secret: app.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
}

/** Gets a fresh day-long access key from the year-long refresh key. */
export function refreshTikTok(fetchFn: typeof fetch, app: TikTokApp, refreshToken: string) {
  return tokenRequest(fetchFn, {
    client_key: app.clientKey,
    client_secret: app.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function fetchTikTokStats(fetchFn: typeof fetch, accessToken: string): Promise<TikTokStats> {
  const res = await fetchFn(USER_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body: any = await res.json().catch(() => ({}));
  const user = body?.data?.user;
  if (!res.ok || (body?.error?.code && body.error.code !== "ok") || !user) {
    throw new Error(body?.error?.message || `TikTok request failed with status ${res.status}`);
  }
  return {
    followers: Number(user.follower_count ?? 0),
    following: Number(user.following_count ?? 0),
    likes: Number(user.likes_count ?? 0),
    videos: Number(user.video_count ?? 0),
  };
}
