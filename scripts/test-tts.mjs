// Sanity check: connect directly to the xAI streaming TTS and save output
// as a WAV file. Helps distinguish API issues from UI issues.
//
// Usage:
//   node scripts/test-tts.mjs "Hello from Grok." eve en
//
// Requires XAI_API_KEY in the environment or in .env / .env.local.

import { WebSocket } from "ws";
import { writeFileSync, existsSync, readFileSync } from "node:fs";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const API_KEY = process.env.XAI_API_KEY;
if (!API_KEY) {
  console.error("Missing XAI_API_KEY — put it in .env.local");
  process.exit(1);
}

const text = process.argv[2] || "Hello! This is a direct test of the xAI Grok text to speech streaming API.";
const voice = process.argv[3] || "eve";
const language = process.argv[4] || "en";
const codec = "pcm";
const sampleRate = 24000;

const url = `wss://api.x.ai/v1/tts?voice=${voice}&language=${language}&codec=${codec}&sample_rate=${sampleRate}`;
console.log("Connecting to:", url);

const ws = new WebSocket(url, {
  headers: { Authorization: `Bearer ${API_KEY}` },
});

const chunks = [];
let msgCount = 0;
const t0 = Date.now();

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c.toString()));
  res.on("end", () => {
    console.error(`HTTP ${res.statusCode} ${res.statusMessage}`);
    console.error(body);
    process.exit(2);
  });
});

ws.on("open", () => {
  console.log(`[open] ${Date.now() - t0} ms`);
  ws.send(JSON.stringify({ type: "text.delta", delta: text }));
  ws.send(JSON.stringify({ type: "text.done" }));
});

ws.on("message", (data, isBinary) => {
  msgCount++;
  if (isBinary) {
    console.log(`[msg #${msgCount}] <binary ${data.length} bytes> — unexpected for TTS`);
    return;
  }
  const text = data.toString("utf8");
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    console.log(`[msg #${msgCount}] non-json:`, text.slice(0, 120));
    return;
  }
  if (event.type === "audio.delta") {
    const buf = Buffer.from(event.delta, "base64");
    chunks.push(buf);
    if (msgCount <= 3 || msgCount % 10 === 0)
      console.log(`[msg #${msgCount}] audio.delta · ${buf.length} bytes`);
  } else if (event.type === "audio.done") {
    console.log(`[msg #${msgCount}] audio.done · trace_id=${event.trace_id || "?"}`);
    const pcm = Buffer.concat(chunks);
    const wav = encodeWav(pcm, sampleRate);
    writeFileSync("test-tts.wav", wav);
    const durationSec = pcm.length / 2 / sampleRate;
    console.log(
      `Saved test-tts.wav — ${pcm.length.toLocaleString()} PCM bytes, ${durationSec.toFixed(2)}s audio, ${Date.now() - t0} ms total`
    );
    ws.close();
  } else {
    console.log(`[msg #${msgCount}]`, event);
  }
});

ws.on("close", (code, reason) => {
  console.log(`[close] code=${code} reason="${reason?.toString() || ""}"`);
});
ws.on("error", (err) => {
  console.error("[error]", err.message);
});

function encodeWav(pcmBuf, sampleRate) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBuf.length;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  pcmBuf.copy(buf, 44);
  return buf;
}
