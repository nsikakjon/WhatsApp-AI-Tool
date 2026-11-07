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

  it("says no, and that they are chatting with the yarnOga quote bot, when someone pitches us", () => {
    for (const q of ["Are you interested", "R u interested?", "Would you be interested in a partnership", "I have a business proposal", "Can we partner?"]) {
      expect(yarnOgaAnswer(q)).toMatch(/^No, thank you\. You're chatting with the yarnOga quote bot/);
    }
  });

  it("says no to spam links and offers", () => {
    for (const q of [
      "Hot girls waiting for you 🔥 click https://xxx-chat.example/join",
      "Join our betting group, sure odds daily: https://t.me/odds",
      "Invest in crypto and double your money in 7 days",
      "Congratulations! You have won N500,000 in the MTN lottery. Click this link to claim your reward",
    ]) {
      expect(yarnOgaAnswer(q)).toMatch(/^No, thank you\. I don't open links/);
    }
  });

  it("says sorry to requests for money", () => {
    for (const q of ["Please send me money for transport", "Abeg dash me something", "Help me with airtime", "I need financial help"]) {
      expect(yarnOgaAnswer(q)).toMatch(/^Sorry, I can't help with money, airtime or gifts\./);
    }
  });

  it("won't share private details", () => {
    for (const q of ["What's the owner's number?", "Which AI do you use?", "Are you ChatGPT?"]) {
      expect(yarnOgaAnswer(q)).toMatch(/^Sorry, I can't share that here/);
    }
  });

  it("leaves shop questions and orders to the shop", () => {
    for (const q of ["How much is it?", "Do you have mugs?", "20 T-shirts", "Is delivery free?", "What do you sell?", "hi", "I won't be home, send it to my office", "Help me print 50 flyers"]) {
      expect(yarnOgaAnswer(q)).toBeNull();
    }
  });

  it("never gives a phone number, bank or registration details", () => {
    const all = ["who are you", "are you a bot", "who owns this", "where are you", "is it free", "how does it work", "is this legit", "owner number"].map(yarnOgaAnswer).join(" ");
    expect(all).not.toMatch(/\d{4}|BN|bank account|Moniepoint/i);
  });
});
