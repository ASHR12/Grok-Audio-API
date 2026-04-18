// AudioWorkletProcessor that converts microphone samples (Float32, mono or
// downmixed) into Int16 PCM chunks and posts them to the main thread.
//
// The main thread is expected to create its AudioContext with
// `sampleRate: 16000` so the browser natively resamples the mic to 16 kHz
// (with proper anti-aliasing). That removes the need for any JS-side
// resampling, which avoids aliasing artefacts that hurt ASR accuracy.
//
// Options:
//   chunkMs: number (default 100) — size of each emitted chunk.

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.chunkMs = opts.chunkMs || 100;
    // globalThis `sampleRate` is the AudioContext rate (expected 16000).
    this.chunkSize = Math.round((sampleRate * this.chunkMs) / 1000);
    this.outBuf = new Int16Array(this.chunkSize);
    this.outIdx = 0;
    this._muted = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "mute") this._muted = !!e.data.value;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    // Downmix to mono (average across channels if needed).
    const numCh = input.length;
    const len = input[0].length;
    for (let i = 0; i < len; i++) {
      let s;
      if (numCh === 1) {
        s = input[0][i];
      } else {
        let sum = 0;
        for (let c = 0; c < numCh; c++) sum += input[c][i];
        s = sum / numCh;
      }
      if (this._muted) s = 0;
      const clamped = s < -1 ? -1 : s > 1 ? 1 : s;
      this.outBuf[this.outIdx++] =
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      if (this.outIdx >= this.chunkSize) {
        const chunk = new Int16Array(this.outBuf);
        this.port.postMessage(chunk.buffer, [chunk.buffer]);
        this.outBuf = new Int16Array(this.chunkSize);
        this.outIdx = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
