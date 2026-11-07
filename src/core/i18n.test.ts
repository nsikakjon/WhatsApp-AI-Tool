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

  it.each([
    "Sannu, nawa ne flyers guda 100?",
    "Ina son kek guda biyu",
    "Don Allah kuna kawo kaya zuwa Kano?",
    "Na gode sosai",
    "Ina kwana, me kuke sayarwa?",
    "Zan biya yanzu",
  ])("hears Hausa in %s", (text) => {
    expect(guessLanguage(text)).toBe("ha");
  });

  it.each([
    "Habari, ni bei gani kwa flyers 100?",
    "Nataka keki mbili",
    "Tafadhali mnaleta Nairobi?",
    "Asante sana",
    "Mambo, mnauza nini?",
    "Nitalipa kesho",
  ])("hears Swahili in %s", (text) => {
    expect(guessLanguage(text)).toBe("sw");
  });

  it.each(["Hi, I need 100 flyers please", "How much is it?", "Can you deliver tomorrow?", "Thanks boss", "yes"])("keeps %s as English", (text) => {
    expect(guessLanguage(text)).toBe("en");
  });

  it("still hears French, and can't tell from a number", () => {
    expect(guessLanguage("Bonjour, je voudrais 2 pagnes")).toBe("fr");
    expect(guessLanguage("200")).toBeNull();
  });

  it("never lets a business pick Pidgin, Hausa or Swahili, and writes documents for those chats in English", () => {
    expect(isLang("pcm")).toBe(false);
    expect(isLang("ha")).toBe(false);
    expect(isLang("sw")).toBe(false);
    expect(writtenLang("pcm")).toBe("en");
    expect(writtenLang("ha")).toBe("en");
    expect(writtenLang("sw")).toBe("en");
    expect(writtenLang("fr")).toBe("fr");
  });
});
