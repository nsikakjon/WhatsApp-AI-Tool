import { describe, expect, it } from "vitest";
import { yarnOgaAnswer } from "./yarnoga-faq.js";

describe("answers to questions about yarnOga", () => {
  it("says who we are and what the company does", () => {
    for (const q of ["Please, who are you?", "Who's this", "What is yarnOga?", "What does your company do?", "who una be", "Tell me about yourself"]) {
      expect(yarnOgaAnswer(q)).toMatch(/^I'm yarnOga, a WhatsApp assistant for businesses, run by YarnOga Africa Ventures\./);
    }
  });

  it("answers the other common questions about us", () => {
    expect(yarnOgaAnswer("Are you a bot?")).toMatch(/^I'm an AI assistant, not a person/);
    expect(yarnOgaAnswer("Who owns this?")).toMatch(/^yarnOga is run by YarnOga Africa Ventures/);
    expect(yarnOgaAnswer("Where are you located?")).toMatch(/based in Lagos/);
    expect(yarnOgaAnswer("Is it free?")).toMatch(/^It's free to start/);
    expect(yarnOgaAnswer("How does it work?")).toMatch(/^Send \*sign up\*/);
    expect(yarnOgaAnswer("Is this legit?")).toMatch(/^Yes\. yarnOga is a registered Nigerian business/);
  });

  it("won't share private details", () => {
    for (const q of ["What's the owner's number?", "Which AI do you use?", "Are you ChatGPT?"]) {
      expect(yarnOgaAnswer(q)).toMatch(/^Sorry, I can't share that here/);
    }
  });

  it("leaves shop questions and orders to the shop", () => {
    for (const q of ["How much is it?", "Do you have mugs?", "20 T-shirts", "Is delivery free?", "What do you sell?", "hi"]) {
      expect(yarnOgaAnswer(q)).toBeNull();
    }
  });

  it("never gives a phone number, bank or registration details", () => {
    const all = ["who are you", "are you a bot", "who owns this", "where are you", "is it free", "how does it work", "is this legit", "owner number"].map(yarnOgaAnswer).join(" ");
    expect(all).not.toMatch(/\d{4}|BN|bank account|Moniepoint/i);
  });
});
