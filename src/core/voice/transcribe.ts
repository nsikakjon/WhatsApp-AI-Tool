// Turns a voice note into text using Groq's hosted Whisper model.

export interface Transcriber {
  transcribe(audio: Blob, mimeType: string): Promise<string>;
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
      form.append("response_format", "json");

      const res = await doFetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}` },
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
      if (!res.ok) {
        throw new Error(`Groq transcription failed (${res.status}): ${data.error?.message ?? "unknown error"}`);
      }
      return (data.text ?? "").trim();
    },
  };
}
