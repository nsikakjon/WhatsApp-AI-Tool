// The wording of the two replies. No prices or availability here, ever: the
// WhatsApp lead qualifier and the agents handle those.

export function privateReplyText(opts: { username?: string; businessName: string; whatsappNumber: string }): string {
  const hello = opts.username ? `Hi @${opts.username}` : "Hi";
  const prefill = encodeURIComponent("Hi, I saw your post on Instagram and I'd like to know more.");
  return (
    `${hello}, thanks for your interest! 🏡\n\n` +
    `For the price, more photos or to book a viewing, chat with ${opts.businessName} on WhatsApp. ` +
    `It only takes a minute:\n` +
    `https://wa.me/${opts.whatsappNumber}?text=${prefill}`
  );
}

export function publicReplyText(username?: string): string {
  return username ? `Thanks @${username}! We've sent you a message with the details 📩` : "Thanks! We've sent you a message with the details 📩";
}
