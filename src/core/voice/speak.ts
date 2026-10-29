import { guessLanguage, type Lang } from "../i18n.js";
import type { Product, Reply } from "../product.js";

// Voice replies: a customer who sends a voice note gets the bot's answer as a
// voice note too, after the text. The words are exactly the reply's text, so
// a price in it is still the one worked out in code. Microsoft Azure Speech
// (free tier) or Google Cloud Text-to-Speech reads it aloud and gives back
// OGG/Opus, the format WhatsApp plays as a voice message.

export interface Speaker {
  /** The text read aloud as an OGG/Opus voice note. */
  speak(text: string, lang: Lang): Promise<Uint8Array>;
}

export interface GoogleSpeakerOptions {
  apiKey: string;
  /** Voice names, e.g. fr-FR-Neural2-A. Defaults suit French-speaking Africa and Nigeria. */
  voices?: Partial<Record<Lang, string>>;
  fetch?: typeof fetch;
}

const DEFAULT_VOICES: Record<Lang, string> = { fr: "fr-FR-Neural2-A", en: "en-GB-Neural2-A" };

export function createGoogleSpeaker(opts: GoogleSpeakerOptions): Speaker {
  const doFetch = opts.fetch ?? fetch;
  return {
    async speak(text, lang) {
      const name = opts.voices?.[lang] ?? DEFAULT_VOICES[lang];
      const res = await doFetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(opts.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: name.split("-").slice(0, 2).join("-"), name },
          audioConfig: { audioEncoding: "OGG_OPUS" },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await res.json().catch(() => ({}))) as { audioContent?: string; error?: { message?: string } };
      if (!res.ok || !body.audioContent) throw new Error(`Text-to-speech failed (${res.status}): ${body.error?.message ?? "no audio"}`);
      return new Uint8Array(Buffer.from(body.audioContent, "base64"));
    },
  };
}

export interface AzureSpeakerOptions {
  /** Key 1 from the Speech resource in the Azure portal (Keys and Endpoint). */
  apiKey: string;
  /** The resource's region, e.g. westeurope. */
  region: string;
  /** Voice names, e.g. fr-FR-DeniseNeural. Defaults: a French voice and a Nigerian English one. */
  voices?: Partial<Record<Lang, string>>;
  fetch?: typeof fetch;
}

const AZURE_VOICES: Record<Lang, string> = { fr: "fr-FR-DeniseNeural", en: "en-NG-EzinneNeural" };

/** Text made safe to put inside the SSML Azure reads. */
function xml(text: string): string {
  return text.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);
}

export function createAzureSpeaker(opts: AzureSpeakerOptions): Speaker {
  const doFetch = opts.fetch ?? fetch;
  const url = `https://${encodeURIComponent(opts.region)}.tts.speech.microsoft.com/cognitiveservices/v1`;
  return {
    async speak(text, lang) {
      const name = opts.voices?.[lang] ?? AZURE_VOICES[lang];
      const locale = name.split("-").slice(0, 2).join("-");
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": opts.apiKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "ogg-24khz-16bit-mono-opus",
          "User-Agent": "yarnoga",
        },
        body: `<speak version="1.0" xml:lang="${locale}"><voice name="${xml(name)}">${xml(text)}</voice></speak>`,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Azure text-to-speech failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
      const audio = new Uint8Array(await res.arrayBuffer());
      if (!audio.length) throw new Error("Azure text-to-speech returned no audio");
      return audio;
    },
  };
}

/** Longer replies (a full price list) are better read than heard. */
const MAX_SPOKEN = 700;

/**
 * The reply as it should sound: WhatsApp's *bold* and _italic_ marks, links
 * and bullet dots taken out. Null when there's nothing worth saying aloud.
 */
export function spokenText(reply: Reply): string | null {
  const text = [reply.text, reply.buttons?.body].filter(Boolean).join("\n\n");
  const clean = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_~]/g, "")
    .replace(/^\s*[•\-]\s*/gm, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (!clean || clean.length > MAX_SPOKEN) return null;
  return clean;
}

/**
 * Wraps a product: when the message was a voice note and voice replies are
 * on for this business, the reply also goes back as a voice note. If speaking
 * fails, the text reply still goes out.
 */
export function withVoiceReplies(
  product: Product,
  opts: { speaker: Speaker; enabled: () => Promise<boolean> | boolean; language?: Lang; log?: Pick<Console, "error"> },
): Product {
  return {
    ...product,
    async handle(msg, ctx) {
      const reply = await product.handle(msg, ctx);
      if (!reply || msg.type !== "audio" || reply.audio) return reply;
      const said = spokenText(reply);
      if (!said || !(await opts.enabled())) return reply;
      try {
        // The bot answers in the customer's language, so that comes first.
        const lang = guessLanguage(msg.text) ?? guessLanguage(said) ?? opts.language ?? "en";
        return { ...reply, audio: { data: await opts.speaker.speak(said, lang), mimeType: "audio/ogg" } };
      } catch (err) {
        (opts.log ?? console).error("Voice reply failed; sending text only:", err);
        return reply;
      }
    },
  };
}
