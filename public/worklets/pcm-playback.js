// AudioWorkletProcessor that plays a queue of PCM16 chunks smoothly.
//
// The main thread posts ArrayBuffers of Int16 LE samples to this processor
// via the message port. Each sample is converted to Float32 on the fly and
// fed into the output buffer. If the queue underruns we output silence —
// the playback just pauses transparently until more data arrives.
//
// This is used for the xAI realtime agent's output audio stream, which
// arrives as PCM16 @ 24 kHz. The main thread's AudioContext must be
// created with `sampleRate: 24000` to match — doing that avoids any
// resampling and gives us sample-accurate jitter-free playback.
//
// Messages from main thread:
//   { buffer: ArrayBuffer }   — enqueue PCM16 samples
//   { type: "clear" }         — drop everything in the queue (barge-in)
//
// Messages to main thread:
//   { type: "level", rms: 0..1 }    — every ~50 ms, for the visualizer
//   { type: "underrun" }            — emitted when queue drains mid-playback
//   { type: "stats", buffered_ms: n } — periodic buffer-depth telemetry
//
// We also post a one-shot "started" event the first time a non-empty chunk
// arrives and begins playing, and a "stopped" event when the queue drains
// back to zero after having played something.

const LEVEL_POST_INTERVAL_SAMPLES = Math.round(sampleRate * 0.05); // ~50ms

class PcmPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = []; // array of Float32Array
    this.readIdx = 0; // index into queue[0]
    this.buffered = 0; // total samples buffered across all chunks
    this.rmsAccum = 0;
    this.rmsCount = 0;
    this.framesSincePost = 0;
    this.playing = false;
    this.ever_played = false;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "clear") {
        this.queue.length = 0;
        this.readIdx = 0;
        this.buffered = 0;
        if (this.playing) {
          this.playing = false;
          this.port.postMessage({ type: "stopped" });
        }
        return;
      }
      if (msg.buffer instanceof ArrayBuffer) {
        const int16 = new Int16Array(msg.buffer);
        const f32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          f32[i] = int16[i] / 0x8000;
        }
        this.queue.push(f32);
        this.buffered += f32.length;
        if (!this.playing && this.buffered > 0) {
          this.playing = true;
          this.ever_played = true;
          this.port.postMessage({ type: "started" });
        }
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const ch0 = output[0];
    const N = ch0.length;
    let produced = 0;

    while (produced < N && this.queue.length > 0) {
      const head = this.queue[0];
      const remainingInHead = head.length - this.readIdx;
      const need = N - produced;
      const take = Math.min(remainingInHead, need);
      for (let i = 0; i < take; i++) {
        const s = head[this.readIdx + i];
        ch0[produced + i] = s;
        this.rmsAccum += s * s;
      }
      this.rmsCount += take;
      produced += take;
      this.readIdx += take;
      this.buffered -= take;
      if (this.readIdx >= head.length) {
        this.queue.shift();
        this.readIdx = 0;
      }
    }

    // Fill remainder with silence (and mirror to additional channels).
    if (produced < N) {
      for (let i = produced; i < N; i++) ch0[i] = 0;
      // Underrun signal — only if we were mid-playback.
      if (this.playing && this.buffered === 0) {
        this.playing = false;
        this.port.postMessage({ type: "stopped" });
      }
    }

    // Duplicate to remaining channels (typical output is stereo).
    for (let c = 1; c < output.length; c++) {
      output[c].set(ch0);
    }

    this.framesSincePost += N;
    if (this.framesSincePost >= LEVEL_POST_INTERVAL_SAMPLES) {
      const rms = this.rmsCount > 0 ? Math.sqrt(this.rmsAccum / this.rmsCount) : 0;
      this.port.postMessage({
        type: "level",
        rms: Math.min(1, rms * 1.8),
        buffered_ms: (this.buffered / sampleRate) * 1000,
      });
      this.rmsAccum = 0;
      this.rmsCount = 0;
      this.framesSincePost = 0;
    }

    return true;
  }
}

registerProcessor("pcm-playback", PcmPlaybackProcessor);
