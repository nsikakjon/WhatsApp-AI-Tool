// Turns a voice note into text using Groq's hosted Whisper model.

export interface Transcription {
  text: string;
  /** How long the voice note was, so its cost can be counted. Null when the service didn't say. */
  seconds: number | null;
}

export interface Transcriber {
  transcribe(audio: Blob, mimeType: string): Promise<Transcription>;
}

export interface GroqTranscriberOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

// WhatsApp voice notes are Ogg/Opus. Groq works out the format from the file
// name, so give it a sensible extension.
function fileNameFor(mimeType: string): string {
  if (mimeType.includes("ogg") || mimeType.includes("opus")) return "voice.ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "voice.mp3";
  if (mimeType.includes("mp4") || mimeType.includes("m4a") || mimeType.includes("aac")) return "voice.m4a";
  if (mimeType.includes("amr")) return "voice.amr";
  if (mimeType.includes("wav")) return "voice.wav";
  return "voice.ogg";
}

export function createGroqTranscriber(opts: GroqTranscriberOptions): Transcriber {
  const doFetch = opts.fetch ?? fetch;

  return {
    async transcribe(audio, mimeType) {
      const form = new FormData();
      form.append("file", audio, fileNameFor(mimeType));
      form.append("model", opts.model);
      // verbose_json also returns the note's length in seconds.
      form.append("response_format", "verbose_json");

      const res = await doFetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}` },
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string; duration?: number; error?: { message?: string } };
      if (!res.ok) {
        throw new Error(`Groq transcription failed (${res.status}): ${data.error?.message ?? "unknown error"}`);
      }
      return { text: (data.text ?? "").trim(), seconds: typeof data.duration === "number" ? data.duration : null };
    },
  };
}
