import { describe, expect, it } from "vitest";
import { guessLanguage, isLang, writtenLang } from "./i18n.js";

describe("guessing the language", () => {
  it.each([
    "Abeg how much for 100 flyers?",
    "how far, wetin una get?",
    "I wan buy 2 cakes",
    "Una dey deliver go Ikeja?",
    "how much e be",
    "No wahala, make I pay now",
  ])("hears Pidgin in %s", (text) => {
    expect(guessLanguage(text)).toBe("pcm");
  });

  it.each(["Hi, I need 100 flyers please", "How much is it?", "Can you deliver tomorrow?", "Thanks boss", "yes"])("keeps %s as English", (text) => {
    expect(guessLanguage(text)).toBe("en");
  });

  it("still hears French, and can't tell from a number", () => {
    expect(guessLanguage("Bonjour, je voudrais 2 pagnes")).toBe("fr");
    expect(guessLanguage("200")).toBeNull();
  });

  it("never lets a business pick Pidgin, and writes documents for Pidgin chats in English", () => {
    expect(isLang("pcm")).toBe(false);
    expect(writtenLang("pcm")).toBe("en");
    expect(writtenLang("fr")).toBe("fr");
  });
});
