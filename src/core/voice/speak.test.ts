import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "../whatsapp/types.js";
import { createGoogleSpeaker, spokenText, withVoiceReplies } from "./speak.js";

const voiceNote: IncomingMessage = { waMessageId: "w1", from: "2250712345678", type: "audio", text: "Je voudrais 2 pagnes", timestamp: 0, raw: {} };
const typed: IncomingMessage = { ...voiceNote, type: "text" };
const ctx = { contactId: "c1", history: [], downloadMedia: async () => ({ data: new Blob([]), mimeType: "" }), sendLater: async () => {}, canMessageFreely: async () => true };

describe("voice replies", () => {
  const bot = { name: "quote", handle: vi.fn(async () => ({ text: "Voici votre devis (CA-1001) :\n\n• 2 x Pagne = *25 000 FCFA*\nPayez ici : https://pay.example/x" })) };

  it("answers a voice note with the reply read aloud in its language, only when switched on", async () => {
    const speaker = { speak: vi.fn(async () => new Uint8Array([1, 2])) };
    const on = withVoiceReplies(bot, { speaker, enabled: () => true });
    const reply = await on.handle(voiceNote, ctx);
    expect(reply?.audio).toEqual({ data: new Uint8Array([1, 2]), mimeType: "audio/ogg" });
    expect(speaker.speak).toHaveBeenCalledWith(expect.stringContaining("25 000 FCFA"), "fr");
    expect(speaker.speak.mock.calls[0]![0]).not.toContain("https://");

    expect((await on.handle(typed, ctx))?.audio).toBeUndefined();
    expect((await withVoiceReplies(bot, { speaker, enabled: () => false }).handle(voiceNote, ctx))?.audio).toBeUndefined();
  });

  it("still sends the text when speaking fails", async () => {
    const speaker = { speak: vi.fn(async () => Promise.reject(new Error("down"))) };
    const reply = await withVoiceReplies(bot, { speaker, enabled: () => true, log: { error() {} } }).handle(voiceNote, ctx);
    expect(reply?.text).toContain("Voici votre devis");
    expect(reply?.audio).toBeUndefined();
  });

  it("keeps long replies as text only and tidies WhatsApp formatting", () => {
    expect(spokenText({ text: "x".repeat(800) })).toBeNull();
    expect(spokenText({ text: "*Total : 5 000 FCFA* 🎉\n• Livraison" })).toBe("Total : 5 000 FCFA \nLivraison");
  });

  it("asks Google for an OGG/Opus voice note", async () => {
    const fetch = vi.fn(async () => Response.json({ audioContent: Buffer.from("ogg").toString("base64") }));
    const audio = await createGoogleSpeaker({ apiKey: "k", fetch: fetch as unknown as typeof globalThis.fetch }).speak("Bonjour", "fr");
    expect(Buffer.from(audio).toString()).toBe("ogg");
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ voice: { languageCode: "fr-FR", name: "fr-FR-Neural2-A" }, audioConfig: { audioEncoding: "OGG_OPUS" } });
  });
});
