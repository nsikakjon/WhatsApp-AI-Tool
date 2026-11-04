import { describe, expect, it } from "vitest";
import { extractMessages } from "./parse.js";

function body(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "PNID" },
              contacts: [{ wa_id: "2348012345678", profile: { name: "Ada" } }],
              messages: [{ from: "2348012345678", id: "wamid.1", timestamp: "1760000000", type: "text", text: { body: "Hi, I saw your ad" }, ...message }],
            },
          },
        ],
      },
    ],
  };
}

describe("ad referrals", () => {
  it("keeps the ad someone tapped to start the chat", () => {
    const [msg] = extractMessages(
      body({
        referral: {
          source_url: "https://fb.me/abc",
          source_id: "120210000000001",
          source_type: "ad",
          headline: "Get your price list on WhatsApp",
          body: "",
          media_type: "video",
          video_url: "https://example.com/v.mp4",
          ctwa_clid: "ARAkLkA8rmlFeiCktEJQ",
        },
      }),
    );
    expect(msg!.referral).toEqual({
      sourceType: "ad",
      sourceId: "120210000000001",
      sourceUrl: "https://fb.me/abc",
      headline: "Get your price list on WhatsApp",
      mediaType: "video",
      ctwaClid: "ARAkLkA8rmlFeiCktEJQ",
    });
  });

  it("leaves it out for an ordinary message", () => {
    const [msg] = extractMessages(body({}));
    expect(msg!.referral).toBeUndefined();
  });

  it("ignores a referral with no ad ID", () => {
    const [msg] = extractMessages(body({ referral: { source_type: "ad", headline: "x" } }));
    expect(msg!.referral).toBeUndefined();
  });
});
