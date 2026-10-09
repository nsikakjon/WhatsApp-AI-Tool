import type { Product } from "../../core/product.js";

// Phase 0 test product: repeats back whatever text it receives.
export const echoProduct: Product = {
  name: "echo",
  async handle(msg) {
    if (msg.type === "text" && msg.text) {
      return { text: `You said: ${msg.text}` };
    }
    return { text: `I got your ${msg.type} message. For now I can only echo text.` };
  },
};
