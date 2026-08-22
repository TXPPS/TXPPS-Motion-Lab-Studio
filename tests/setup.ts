import 'fake-indexeddb/auto';

// jsdom lacks structuredClone in some versions
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (v: unknown) => JSON.parse(JSON.stringify(v));
}

/**
 * jsdom has no `AudioBuffer`, and plenty of code that is not "audio code"
 * reaches one: the procedural media generator builds one to render a drum hit,
 * and the sampler builds one to play a zone backwards. The constructor's
 * options are the whole of what either needs, so a stand-in for it is four
 * fields and an array.
 */
class AudioBufferStub {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private channels: Float32Array[];
  constructor(opts: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = opts.numberOfChannels;
    this.length = opts.length;
    this.sampleRate = opts.sampleRate;
    this.duration = opts.length / opts.sampleRate;
    this.channels = Array.from(
      { length: opts.numberOfChannels },
      () => new Float32Array(opts.length),
    );
  }
  getChannelData(i: number): Float32Array {
    return this.channels[i];
  }
  copyToChannel(source: Float32Array, i: number): void {
    this.channels[i].set(source.subarray(0, this.channels[i].length));
  }
}
if (typeof globalThis.AudioBuffer === 'undefined') {
  globalThis.AudioBuffer = AudioBufferStub as unknown as typeof AudioBuffer;
}
