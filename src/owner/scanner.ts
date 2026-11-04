import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Hono } from "hono";
import type { Env } from "./types.js";

// Barcode scanning with the phone camera (QUOTE_BARCODES). Chrome on Android
// reads barcodes itself (BarcodeDetector); iPhones and older browsers get
// ZXing, served from here and loaded only when someone taps Scan.

/** Same code, however the scanner wrote it: UPC-A and EAN-13 differ by a leading 0. */
export function barcodeKey(code: string): string {
  const c = code.trim();
  return /^\d+$/.test(c) ? c.replace(/^0+(?=\d)/, "") : c.toUpperCase();
}

export const BARCODE = /^[0-9A-Za-z./+-]{1,48}$/;

let zxing: { plain: Buffer; gzip: Buffer } | undefined;
function zxingFiles() {
  if (!zxing) {
    const path = createRequire(import.meta.url).resolve("@zxing/library/umd/index.min.js");
    zxing = { plain: readFileSync(path), gzip: readFileSync(`${path}.gz`) };
  }
  return zxing;
}

export function registerScannerAssets(app: Hono<Env>) {
  app.get("/assets/zxing.js", (c) => {
    const files = zxingFiles();
    const gzip = /\bgzip\b/.test(c.req.header("accept-encoding") ?? "");
    c.header("Cache-Control", "public, max-age=604800");
    c.header("Vary", "Accept-Encoding");
    if (gzip) c.header("Content-Encoding", "gzip");
    return c.body((gzip ? files.gzip : files.plain) as unknown as ArrayBuffer, 200, { "Content-Type": "text/javascript; charset=utf-8" });
  });
}

/**
 * The camera box and the script behind it. The page calls
 * `scanBarcodes(onCode, keepGoing)` from a button: with keepGoing the camera
 * stays open for the next item, and the same code is taken once every 2 seconds.
 */
export function scannerBox(): string {
  return `<div id="scanner" class="card" hidden style="margin:10px 0"><video playsinline muted style="width:100%;max-width:420px;border-radius:10px;display:block;background:#000"></video>
<p class="muted small" id="scan-note" style="margin:8px 0" aria-live="polite">Hold the barcode inside the picture.</p><button type="button" class="ghost small" id="scan-stop">Stop scanning</button></div>
<script>
(function () {
  const box = document.getElementById("scanner"), video = box.querySelector("video");
  const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];
  let stream = null, last = "", lastAt = 0;
  function stop() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    box.hidden = true;
  }
  document.getElementById("scan-stop").onclick = stop;
  function loadZxing() {
    if (window.ZXing) return Promise.resolve();
    return new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = "/home/assets/zxing.js";
      s.onload = ok;
      s.onerror = fail;
      document.head.appendChild(s);
    });
  }
  async function reader() {
    if ("BarcodeDetector" in window) {
      const have = await BarcodeDetector.getSupportedFormats().catch(() => []);
      const use = FORMATS.filter((f) => have.includes(f));
      if (use.includes("ean_13")) {
        const detector = new BarcodeDetector({ formats: use });
        return async () => ((await detector.detect(video).catch(() => []))[0] || {}).rawValue;
      }
    }
    await loadZxing();
    const zx = new ZXing.MultiFormatReader();
    zx.setHints(new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]));
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    return async () => {
      const scale = Math.min(1, 800 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        return zx.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(canvas)))).getText();
      } catch (e) {
        return undefined;
      }
    };
  }
  window.scanBarcodes = async function (onCode, keepGoing) {
    if (stream) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch (e) {
      alert("The camera didn't open. Allow camera use for this page and try again, or type the barcode number.");
      return;
    }
    box.hidden = false;
    box.scrollIntoView({ block: "nearest" });
    video.srcObject = stream;
    await video.play();
    let read;
    try {
      read = await reader();
    } catch (e) {
      stop();
      alert("The scanner didn't load. Check the internet connection and try again.");
      return;
    }
    const look = async () => {
      if (!stream) return;
      const code = video.readyState >= 2 ? await read() : undefined;
      if (code && (code !== last || Date.now() - lastAt > 2000)) {
        last = code;
        lastAt = Date.now();
        if (navigator.vibrate) navigator.vibrate(60);
        onCode(code.trim());
        if (!keepGoing) return stop();
      }
      setTimeout(look, 120);
    };
    look();
  };
})();
</script>`;
}

/** The browser half of barcodeKey, for matching on the page. */
export const BARCODE_KEY_JS = `function barcodeKey(c) { c = c.trim(); return /^\\d+$/.test(c) ? c.replace(/^0+(?=\\d)/, "") : c.toUpperCase(); }`;
