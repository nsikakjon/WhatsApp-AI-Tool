// The sign-up page: one button that opens Meta's "Embedded Signup" pop-up. The
// business logs in with Facebook, picks its business, and scans a QR code with
// the WhatsApp Business app so the number keeps working in the app
// (coexistence). The page then sends the result to /signup/complete.

export interface SignupPageOptions {
  appId: string;
  configId: string;
  graphApiVersion: string;
}

/** Puts a value inside a <script> safely (no early </script>). */
function js(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderSignupPage(opts: SignupPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Connect your WhatsApp number</title>
<style>
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #0c0d0d; color: #f3f4ef; }
  main { max-width: 560px; margin: 0 auto; padding: 32px 16px; }
  h1 { font-size: 1.6rem; line-height: 1.2; }
  ol { padding-left: 1.2rem; }
  button { font: inherit; font-weight: 600; background: #c6ff1f; color: #0c0d0d; border: 0; border-radius: 10px;
    padding: 14px 20px; cursor: pointer; width: 100%; margin: 16px 0; }
  button:disabled { opacity: .5; cursor: default; }
  #status { min-height: 1.5em; color: #c9cbc4; }
  #status.ok { color: #c6ff1f; }
  #status.err { color: #ff8a80; }
</style>
</head>
<body>
<main>
  <h1>Connect your WhatsApp number to the bot</h1>
  <p>Your number stays in the WhatsApp Business app on your phone. The bot answers customers, and whenever you reply
  yourself from the app, it steps back in that chat.</p>
  <ol>
    <li>Have the phone with the WhatsApp Business app nearby (version 2.24.17 or newer).</li>
    <li>Tap the button and log in with the Facebook account that manages your business.</li>
    <li>Choose your business, then choose to connect your existing WhatsApp Business app.</li>
    <li>Scan the QR code that appears, using the WhatsApp Business app.</li>
  </ol>
  <button id="go" disabled>Connect my WhatsApp Business app</button>
  <p id="status">Loading…</p>
</main>
<script>
  const APP_ID = ${js(opts.appId)};
  const CONFIG_ID = ${js(opts.configId)};
  const VERSION = ${js(opts.graphApiVersion)};
  const button = document.getElementById("go");
  const status = document.getElementById("status");
  let session = null; // { waba_id, phone_number_id, coexistence } from Meta's pop-up
  let code = null;    // one-time code from the Facebook login
  let sent = false;

  function show(text, kind) {
    status.textContent = text;
    status.className = kind || "";
  }

  // Meta's pop-up reports which WhatsApp account and number were picked.
  window.addEventListener("message", (event) => {
    if (!/(^|\\.)facebook\\.com$/.test(new URL(event.origin).hostname)) return;
    let data;
    try { data = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
    if (!data || data.type !== "WA_EMBEDDED_SIGNUP") return;
    if (data.event === "CANCEL") {
      show("The sign-up was closed before it finished. You can try again.", "err");
      button.disabled = false;
      return;
    }
    if (String(data.event).startsWith("FINISH") && data.data) {
      session = {
        waba_id: data.data.waba_id,
        phone_number_id: data.data.phone_number_id,
        coexistence: data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      };
      finish();
    }
  });

  async function finish() {
    if (sent || !session || !code) return;
    sent = true;
    show("Finishing the connection…");
    try {
      const res = await fetch("/signup/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, ...session }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Something went wrong.");
      show(body.message, "ok");
    } catch (err) {
      sent = false;
      button.disabled = false;
      show("It didn't finish: " + err.message + " Please try again.", "err");
    }
  }

  window.fbAsyncInit = function () {
    FB.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: VERSION });
    button.disabled = false;
    show("");
  };

  button.addEventListener("click", () => {
    button.disabled = true;
    show("Follow the steps in the Facebook window…");
    FB.login((response) => {
      if (response.authResponse && response.authResponse.code) {
        code = response.authResponse.code;
        finish();
      } else if (!session) {
        button.disabled = false;
        show("The sign-up was closed before it finished. You can try again.", "err");
      }
    }, {
      config_id: CONFIG_ID,
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
    });
  });
</script>
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script>
</body>
</html>`;
}
