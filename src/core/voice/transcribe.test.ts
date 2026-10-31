import { describe, expect, it } from "vitest";
import { createGroqTranscriber } from "./transcribe.js";

describe("Groq transcriber", () => {
  it("uploads the voice note and returns the text", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ text: " I need 50 flyers ", duration: 4.2 }), { status: 200 });
    }) as unknown as typeof fetch;

    const t = createGroqTranscriber({ apiKey: "KEY", model: "whisper-large-v3-turbo", fetch: fakeFetch });
    const result = await t.transcribe(new Blob(["audio"]), "audio/ogg; codecs=opus");

    expect(result).toEqual({ text: "I need 50 flyers", seconds: 4.2 });
    expect(captured?.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect((captured?.init.headers as Record<string, string>).Authorization).toBe("Bearer KEY");
    const form = captured?.init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect((form.get("file") as File).name).toBe("voice.ogg");
    expect(form.get("response_format")).toBe("verbose_json");
  });

  it("throws with Groq's message when it fails", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })) as unknown as typeof fetch;
    const t = createGroqTranscriber({ apiKey: "x", model: "m", fetch: fakeFetch });
    await expect(t.transcribe(new Blob(["a"]), "audio/ogg")).rejects.toThrow("bad key");
  });
});
