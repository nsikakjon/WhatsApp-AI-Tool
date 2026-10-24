// The public sign-up page. The business picks how its number connects, then
// Meta's "Embedded Signup" pop-up does the rest: Facebook login, choosing the
// business portfolio, and either scanning a QR code with the WhatsApp Business
// app (coexistence) or verifying a new number by SMS. The page then sends the
// result to /signup/complete. Styled like yarnoga.com.

export interface SignupPageOptions {
  appId: string;
  configId: string;
  graphApiVersion: string;
}

const SITE = "https://yarnoga.com";

/** Puts a value inside a <script> safely (no early </script>). */
function js(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderSignupPage(opts: SignupPageOptions): string {
  return `<!doctype html>
<html lang="en-NG">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0a0d0b">
<title>Connect your WhatsApp number | yarnOga</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@700&family=Instrument+Sans:wght@400;500;600&family=Schibsted+Grotesk:wght@400;600;700&display=swap">
<style>
  :root {
    --bg: #0a0d0b; --panel: #0f1411; --line: rgba(243, 241, 230, .1); --line-2: rgba(243, 241, 230, .2);
    --text: #f3f1e6; --muted: rgba(243, 241, 230, .64); --faint: rgba(243, 241, 230, .42);
    --neon: #c6ff1f; --neon-ink: #121400; --mint: #2ee5a0; --error: #ff8a7a;
    --display: "Chakra Petch", "Schibsted Grotesk", Arial, sans-serif;
    --accent: "Schibsted Grotesk", "Helvetica Neue", Arial, sans-serif;
    --body: "Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    --radius: 6px; --gut: clamp(16px, 4vw, 40px);
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.6 var(--body); -webkit-font-smoothing: antialiased; }
  a { color: inherit; }
  h1, h2 { margin: 0; font-family: var(--display); font-weight: 700; line-height: 1.05; letter-spacing: -0.02em; text-wrap: balance; }
  h3 { margin: 0; font: 700 19px/1.25 var(--accent); letter-spacing: -0.01em; }
  p, ol, ul { margin: 0; }
  :focus-visible { outline: 2px solid var(--neon); outline-offset: 3px; border-radius: 4px; }
  .shell { max-width: 1100px; margin: 0 auto; padding-inline: var(--gut); }
  header { border-bottom: 1px solid var(--line); }
  header .shell { display: flex; align-items: center; justify-content: space-between; height: 64px; }
  .logo { text-decoration: none; font: 700 22px/1 var(--accent); letter-spacing: -0.03em; }
  .logo span, .hl { color: var(--neon); }
  header a.help { font-size: 15px; color: var(--muted); text-decoration: none; }
  main { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 5fr); gap: clamp(32px, 6vw, 80px); padding-block: clamp(40px, 7vw, 88px); align-items: start; }
  .eyebrow { font: 600 13px/1.3 var(--body); letter-spacing: .14em; text-transform: uppercase; color: var(--mint); }
  .intro { display: grid; gap: 20px; }
  .intro h1 { font-size: clamp(36px, 5vw, 60px); }
  .lede { font-size: clamp(17px, 1.6vw, 19px); color: var(--muted); max-width: 34em; }
  .facts { display: grid; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; margin-top: 12px; }
  .facts > div { background: var(--bg); padding: 20px 24px; display: grid; gap: 6px; }
  .facts p { color: var(--muted); font-size: 15px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: clamp(22px, 3vw, 32px); }
  .card h2 { font-size: 26px; }
  fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 10px; }
  legend { padding: 0; margin-bottom: 10px; font-size: 15px; color: var(--muted); }
  .option { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; padding: 16px; border: 1px solid var(--line-2); border-radius: var(--radius); cursor: pointer; transition: border-color .15s ease, background .15s ease; }
  .option:hover { border-color: var(--text); }
  .option:has(input:checked) { border-color: var(--neon); background: rgba(198, 255, 31, .05); }
  .option input { grid-row: span 2; margin: 4px 0 0; accent-color: var(--neon); width: 18px; height: 18px; }
  .option b { font: 600 16px/1.3 var(--accent); }
  .option span { color: var(--muted); font-size: 14px; line-height: 1.5; }
  .steps { padding-left: 1.2em; display: grid; gap: 6px; color: var(--muted); font-size: 15px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 15px 20px; border: 0; border-radius: var(--radius); font: 600 17px/1.2 var(--accent); cursor: pointer; background: var(--neon); color: var(--neon-ink); box-shadow: 4px 4px 0 var(--mint); transition: transform .15s ease, box-shadow .15s ease; text-decoration: none; }
  .btn:hover:not(:disabled) { transform: translate(-1px, -1px); box-shadow: 5px 5px 0 var(--mint); }
  .btn:active:not(:disabled) { transform: translate(3px, 3px); box-shadow: 1px 1px 0 var(--mint); }
  .btn:disabled { opacity: .45; cursor: default; box-shadow: none; }
  .btn svg { width: 20px; height: 20px; flex: none; }
  .note { color: var(--faint); font-size: 13px; line-height: 1.5; }
  .note a { color: var(--muted); }
  #status { min-height: 1.6em; font-size: 15px; color: var(--muted); }
  #status.err { color: var(--error); }
  .flow { display: grid; gap: 18px; }
  .flow.tight { gap: 8px; }
  .muted { color: var(--muted); font-size: 15px; }
  .muted a { color: var(--neon); }
  .done h2 { color: var(--neon); }
  .done dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; font-size: 15px; }
  .done dt { color: var(--faint); }
  .done dd { margin: 0; overflow-wrap: anywhere; }
  .pin { font: 700 22px/1 var(--accent); letter-spacing: .2em; color: var(--neon); }
  [hidden] { display: none !important; }
  footer { border-top: 1px solid var(--line); padding-block: 28px 40px; font-size: 14px; color: var(--muted); }
  footer .shell { display: flex; flex-wrap: wrap; gap: 12px 24px; justify-content: space-between; }
  footer nav { display: flex; flex-wrap: wrap; gap: 8px 20px; }
  footer a { text-decoration: none; }
  footer a:hover { color: var(--text); }
  @media (max-width: 860px) { main { grid-template-columns: minmax(0, 1fr); } }
</style>
</head>
<body>
<header>
  <div class="shell">
    <a class="logo" href="${SITE}/">yarn<span>Oga</span></a>
    <a class="help" href="mailto:support@yarnoga.com">Need help?</a>
  </div>
</header>
<main class="shell">
  <section class="intro">
    <p class="eyebrow">Connect your number</p>
    <h1>Put your WhatsApp number to <span class="hl">work.</span></h1>
    <p class="lede">Connect your business's WhatsApp number to yarnOga, and our AI sales assistant answers your customers on it:
    price quotes from your own price list, orders, invoices and payment links, day and night.</p>
    <div class="facts">
      <div>
        <h3>What connecting allows</h3>
        <p>Through Meta's secure window you let yarnOga receive the messages customers send to your number and reply to them,
        and manage your WhatsApp account's message templates. Nothing else on your Facebook account is shared.</p>
      </div>
      <div>
        <h3>What happens next</h3>
        <p>Your business appears in yarnOga with the assistant switched off, so customers get no automatic replies yet. We add your price list with you,
        you test it, and then we switch it on.</p>
      </div>
      <div>
        <h3>You stay in control</h3>
        <p>Remove yarnOga's access at any time in Meta Business Settings, or ask us to delete your data. Meta bills WhatsApp
        message fees to your own WhatsApp account.</p>
      </div>
    </div>
  </section>

  <section class="card" aria-live="polite">
    <div id="form" class="flow">
      <h2>Connect with WhatsApp</h2>
      <fieldset>
        <legend>How is your number used today?</legend>
        <label class="option">
          <input type="radio" name="kind" value="app" checked>
          <b>It's on the WhatsApp Business app</b>
          <span>Keep using the app on your phone. The assistant answers alongside you and steps back in a chat when you reply yourself.</span>
        </label>
        <label class="option">
          <input type="radio" name="kind" value="new">
          <b>It's a new number</b>
          <span>A number not on WhatsApp yet. You get a code by SMS or call to prove it's yours. It won't work in the WhatsApp app afterwards.</span>
        </label>
      </fieldset>
      <ol class="steps" id="steps-app">
        <li>Keep the phone with the WhatsApp Business app nearby (version 2.24.17 or newer).</li>
        <li>Log in with the Facebook account that manages your business, then choose your business.</li>
        <li>Choose to connect your existing WhatsApp Business app and scan the QR code with it.</li>
      </ol>
      <ol class="steps" id="steps-new" hidden>
        <li>Keep the phone with the new SIM nearby.</li>
        <li>Log in with the Facebook account that manages your business, then choose your business.</li>
        <li>Enter the number and the code Meta sends to it.</li>
      </ol>
      <button class="btn" id="go" disabled>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>
        Connect with WhatsApp
      </button>
      <p id="status" role="status">Loading…</p>
      <p class="note">Opens a Facebook window run by Meta. By connecting you agree to our <a href="${SITE}/terms.html">terms</a>
      and <a href="${SITE}/privacy.html">privacy policy</a>.</p>
    </div>

    <div id="done" class="flow done" hidden>
      <p class="eyebrow">Connected</p>
      <h2>Your number is connected.</h2>
      <dl>
        <dt>Number</dt><dd id="d-number"></dd>
        <dt>Name</dt><dd id="d-name"></dd>
        <dt>Phone number ID</dt><dd id="d-id"></dd>
      </dl>
      <div id="pin-box" class="flow tight" hidden>
        <p>Your number's two-step verification PIN. Write it down: you need it if you ever move the number.</p>
        <p class="pin" id="d-pin"></p>
      </div>
      <p class="muted">The assistant is switched off for now, so customers get no automatic replies yet. We'll get in touch to add your
      price list and switch it on. Questions? <a href="mailto:support@yarnoga.com">support@yarnoga.com</a></p>
    </div>
  </section>
</main>
<footer>
  <div class="shell">
    <p>yarnOga is a product of Kahn Digital Company Ltd, Lagos.</p>
    <nav aria-label="Policies">
      <a href="${SITE}/privacy.html">Privacy</a>
      <a href="${SITE}/terms.html">Terms</a>
      <a href="${SITE}/data-deletion.html">Data deletion</a>
      <a href="mailto:support@yarnoga.com">support@yarnoga.com</a>
    </nav>
  </div>
</footer>
<script>
  const APP_ID = ${js(opts.appId)};
  const CONFIG_ID = ${js(opts.configId)};
  const VERSION = ${js(opts.graphApiVersion)};
  const $ = (id) => document.getElementById(id);
  const button = $("go");
  const status = $("status");
  let session = null; // { waba_id, phone_number_id, coexistence } from Meta's pop-up
  let code = null;    // one-time code from the Facebook login
  let sent = false;

  function show(text, isError) {
    status.textContent = text;
    status.className = isError ? "err" : "";
  }
  function retry(text) {
    session = null; code = null; sent = false;
    button.disabled = false;
    show(text, true);
  }
  const kind = () => document.querySelector("input[name=kind]:checked").value;

  document.querySelectorAll("input[name=kind]").forEach((input) => input.addEventListener("change", () => {
    $("steps-app").hidden = kind() !== "app";
    $("steps-new").hidden = kind() !== "new";
  }));

  // Meta's pop-up reports which WhatsApp account and number were picked.
  window.addEventListener("message", (event) => {
    let host;
    try { host = new URL(event.origin).hostname; } catch { return; }
    if (!/(^|\\.)facebook\\.com$/.test(host)) return;
    let data;
    try { data = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
    if (!data || data.type !== "WA_EMBEDDED_SIGNUP") return;
    if (data.event === "CANCEL") return retry("The Facebook window was closed before the end. You can try again.");
    if (data.event === "ERROR") return retry("Meta stopped the sign-up: " + ((data.data && data.data.error_message) || "unknown error") + ". You can try again.");
    if (data.event === "FINISH_ONLY_WABA") return retry("A WhatsApp account was made but no number was added. Please try again and add your number.");
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
      $("d-number").textContent = body.number || "Not shown by Meta yet";
      $("d-name").textContent = body.name || "Not shown by Meta yet";
      $("d-id").textContent = body.phoneNumberId;
      if (body.pin) { $("d-pin").textContent = body.pin; $("pin-box").hidden = false; }
      $("form").hidden = true;
      $("done").hidden = false;
    } catch (err) {
      retry("It didn't finish: " + err.message + " Please try again, or email support@yarnoga.com.");
    }
  }

  window.fbAsyncInit = function () {
    FB.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: VERSION });
    button.disabled = false;
    show("");
  };
  setTimeout(() => { if (button.disabled && !code) show("The Facebook window can't load. Turn off any ad or tracker blocker for this page and reload.", true); }, 10000);

  button.addEventListener("click", () => {
    button.disabled = true;
    show("Follow the steps in the Facebook window…");
    FB.login((response) => {
      if (response.authResponse && response.authResponse.code) {
        code = response.authResponse.code;
        finish();
      } else if (!session) {
        retry("The Facebook window was closed before the end. You can try again.");
      }
    }, {
      config_id: CONFIG_ID,
      response_type: "code",
      override_default_response_type: true,
      extras: {
        setup: {},
        featureType: kind() === "app" ? "whatsapp_business_app_onboarding" : "",
        sessionInfoVersion: "3",
      },
    });
  });
</script>
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script>
</body>
</html>`;
}
