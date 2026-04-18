// Test the local /api/ws/tts proxy end-to-end (requires `npm run dev` running).
import { WebSocket } from "ws";

const url = "ws://localhost:3000/api/ws/tts?voice=eve&language=en&codec=pcm&sample_rate=24000";
console.log("Connecting to:", url);

const ws = new WebSocket(url);
let bytes = 0;
let msgs = 0;
const t0 = Date.now();

ws.on("open", () => {
  console.log(`[open] ${Date.now() - t0} ms`);
  ws.send(JSON.stringify({ type: "text.delta", delta: "Testing the proxy path." }));
  ws.send(JSON.stringify({ type: "text.done" }));
});

ws.on("message", (data, isBinary) => {
  msgs++;
  if (isBinary) {
    console.log(`[msg #${msgs}] binary ${data.length} bytes`);
    return;
  }
  const text = data.toString("utf8");
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    console.log(`[msg #${msgs}] non-json:`, text.slice(0, 120));
    return;
  }
  if (event.type === "audio.delta") {
    const buf = Buffer.from(event.delta, "base64");
    bytes += buf.length;
    if (msgs <= 3) console.log(`[msg #${msgs}] audio.delta · ${buf.length} bytes`);
  } else {
    console.log(`[msg #${msgs}]`, event);
  }
});

ws.on("close", (code, reason) => {
  console.log(
    `[close] code=${code} reason="${reason?.toString() || ""}" · total ${msgs} msgs, ${bytes.toLocaleString()} PCM bytes in ${Date.now() - t0} ms`
  );
});
ws.on("error", (err) => console.error("[error]", err.message));
