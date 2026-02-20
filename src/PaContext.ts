/**
 * PaContext — manages a single PortAudio stream's full lifecycle.
 *
 * Call sequence:
 *   new PaContext(inOpts?, outOpts?) → open() → start()
 *     → writeChunk() / readChunk() loops
 *   → stop('WAIT' | 'ABORT') → [stream is closed and Pa_Terminate called]
 *
 * All blocking PortAudio calls (writeChunk, readChunk, stop) dispatch to the
 * libuv thread pool via koffi's .async() + util.promisify, keeping the Node.js
 * event loop completely free.
 */

import {
  checkErr,
  getSampleFormat,
  decodeVersionInfo,
  decodeDeviceInfo,
  decodeStreamInfo,
  Pa_Initialize,
  Pa_Terminate,
  Pa_GetDeviceCount,
  Pa_GetDefaultInputDevice,
  Pa_GetDefaultOutputDevice,
  Pa_GetDeviceInfo,
  Pa_GetVersionInfo,
  Pa_IsFormatSupported,
  Pa_OpenStream,
  Pa_CloseStream,
  Pa_GetStreamInfo,
  Pa_StartStream,
  Pa_StopStream_async,
  Pa_AbortStream_async,
  Pa_WriteStream_async,
  Pa_ReadStream_async,
  paNoError,
  paNoDevice,
  paFormatIsSupported,
  paFramesPerBufferUnspecified,
  paNoFlag,
  paInputOverflowed,
  paOutputUnderflowed,
  type PaStreamPtr,
} from './portaudio';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Internal: AudioOptions with all defaults resolved */
export interface ResolvedAudioOptions {
  deviceId:        number;   // -1 = default
  sampleRate:      number;
  channelCount:    number;
  sampleFormat:    1 | 8 | 16 | 24 | 32;
  maxQueue:        number;
  framesPerBuffer: number;
  closeOnError:    boolean;
  highwaterMark:   number;
}

export type StopFlag = 'WAIT' | 'ABORT';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Number of bytes per single sample (NOT per frame) for a given sampleFormat */
function bytesPerSample(sampleFormat: number): number {
  return sampleFormat === 1 ? 4 : sampleFormat / 8;
}

// ─────────────────────────────────────────────────────────────────────────────
// PaContext
// ─────────────────────────────────────────────────────────────────────────────

export class PaContext {
  private readonly _inOpts:  ResolvedAudioOptions | null;
  private readonly _outOpts: ResolvedAudioOptions | null;
  private _stream:  PaStreamPtr | null = null;
  private _stopped = false;
  private _started = false;

  private readonly _inBytesPerFrame:  number;
  private readonly _outBytesPerFrame: number;

  constructor(
    inOpts:  ResolvedAudioOptions | null,
    outOpts: ResolvedAudioOptions | null,
  ) {
    this._inOpts  = inOpts;
    this._outOpts = outOpts;

    this._inBytesPerFrame  = inOpts
      ? inOpts.channelCount  * bytesPerSample(inOpts.sampleFormat)
      : 0;
    this._outBytesPerFrame = outOpts
      ? outOpts.channelCount * bytesPerSample(outOpts.sampleFormat)
      : 0;
  }

  get hasInput():  boolean { return this._inOpts  !== null; }
  get hasOutput(): boolean { return this._outOpts !== null; }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Pa_Initialize + Pa_OpenStream (blocking/null-callback mode).
   * This is fast (< 1 ms on most systems) and safe to call synchronously.
   */
  open(): void {
    checkErr(Pa_Initialize(), 'Pa_Initialize');

    const inOpts  = this._inOpts;
    const outOpts = this._outOpts;

    if (inOpts && outOpts && inOpts.sampleRate !== outOpts.sampleRate) {
      Pa_Terminate();
      throw new Error('AudioIO: Input and Output sample rates must match');
    }

    const sampleRate = (inOpts ?? outOpts!).sampleRate;
    let inParams:  object | null = null;
    let outParams: object | null = null;

    try {
      if (inOpts)  inParams  = this._buildParams(inOpts,  true);
      if (outOpts) outParams = this._buildParams(outOpts, false);
    } catch (err) {
      Pa_Terminate();
      throw err;
    }

    // framesPerBuffer: 0 = let PortAudio choose (optimal for blocking mode on all platforms)
    // ARM devices benefit from a fixed buffer to avoid underruns.
    const arch = process.arch;
    let framesPerBuffer = paFramesPerBufferUnspecified;
    const inFpb  = inOpts?.framesPerBuffer  ?? 0;
    const outFpb = outOpts?.framesPerBuffer ?? 0;
    if (inFpb !== 0 || outFpb !== 0)
      framesPerBuffer = Math.max(inFpb, outFpb);
    if ((arch === 'arm' || arch === 'arm64') && framesPerBuffer === 0)
      framesPerBuffer = 256;

    // Verify format support
    const fmtCheck = Pa_IsFormatSupported(inParams, outParams, sampleRate);
    if (fmtCheck !== paFormatIsSupported) {
      Pa_Terminate();
      throw new Error(`AudioIO: Format not supported: ${fmtCheck}`);
    }

    // Open in blocking mode — null for callback and userData
    const streamRef: unknown[] = [null];
    const openErr = Pa_OpenStream(
      streamRef, inParams, outParams,
      sampleRate, framesPerBuffer, paNoFlag,
      null, null,
    );
    if (openErr !== paNoError) {
      Pa_Terminate();
      throw new Error(`AudioIO: Pa_OpenStream failed (${openErr})`);
    }
    this._stream = streamRef[0] as PaStreamPtr;

    // Log version and actual latency for diagnostics
    const verPtr = Pa_GetVersionInfo();
    if (verPtr) {
      const ver = decodeVersionInfo(verPtr);
      console.log(ver.versionText);
    }
    const infoPtr = Pa_GetStreamInfo(this._stream);
    if (infoPtr) {
      const info = decodeStreamInfo(infoPtr);
      if (inOpts)  console.log(`Input  device latency: ${(info.inputLatency  * 1000).toFixed(1)} ms`);
      if (outOpts) console.log(`Output device latency: ${(info.outputLatency * 1000).toFixed(1)} ms`);
    }
  }

  /** Pa_StartStream — must be called after open(). Idempotent. */
  start(): void {
    if (!this._stream) throw new Error('AudioIO: stream not opened');
    if (this._started) return;
    checkErr(Pa_StartStream(this._stream), 'Pa_StartStream');
    this._started = true;
  }

  /**
   * Stop the stream and release all PortAudio resources.
   * - 'WAIT'  : Pa_StopStream — blocks on libuv thread until DAC drains (physically complete)
   * - 'ABORT' : Pa_AbortStream — discards pending audio immediately
   * Idempotent: safe to call more than once.
   */
  async stop(flag: StopFlag): Promise<void> {
    if (this._stopped) return;
    this._stopped = true;
    if (!this._stream) return;

    const stream = this._stream;
    this._stream = null; // prevent any new readChunk/writeChunk from starting

    if (this._started) {
      if (flag === 'ABORT')
        await Pa_AbortStream_async(stream);
      else
        await Pa_StopStream_async(stream); // blocks until the DAC emits the last sample
    }

    Pa_CloseStream(stream);
    Pa_Terminate();
  }

  // ── Blocking I/O ───────────────────────────────────────────────────────────

  /**
   * Write one chunk to the PortAudio output stream.
   * Pa_WriteStream blocks on a libuv worker thread; the event loop stays free.
   * Node's Writable backpressure naturally paces writes to the hardware rate.
   */
  async writeChunk(chunk: Buffer): Promise<void> {
    if (!this._stream || this._stopped) return;
    if (!this._started) this.start();
    const frames = Math.floor(chunk.length / this._outBytesPerFrame);
    if (frames === 0) return;

    const err = await Pa_WriteStream_async(this._stream, chunk, frames);

    if (err === paOutputUnderflowed) {
      // Non-fatal: PA inserted silence; log and continue
      console.error('AudioIO: output underflow');
      return;
    }
    if (err !== paNoError) {
      const msg = `Pa_WriteStream failed (${err})`;
      if (this._outOpts?.closeOnError !== false) throw new Error(msg);
      console.error(`AudioIO: ${msg}`);
    }
  }

  /**
   * Read one chunk from the PortAudio input stream into a new Buffer.
   * Pa_ReadStream blocks on a libuv worker thread; the event loop stays free.
   * Returns null when the stream is stopped.
   */
  async readChunk(numBytes: number): Promise<Buffer | null> {
    if (!this._stream || this._stopped) return null;
    if (!this._started) this.start();
    const frames = Math.floor(numBytes / this._inBytesPerFrame);
    if (frames === 0) return null;

    const buf = Buffer.alloc(frames * this._inBytesPerFrame);
    const err = await Pa_ReadStream_async(this._stream, buf, frames);

    // _stopped may have become true while we were blocked in Pa_ReadStream
    if (this._stopped) return null;

    if (err === paInputOverflowed) {
      console.error('AudioIO: input overflow');
      return buf; // data is still valid even during overflow
    }
    if (err !== paNoError) {
      const msg = `Pa_ReadStream failed (${err})`;
      if (this._inOpts?.closeOnError !== false) throw new Error(msg);
      console.error(`AudioIO: ${msg}`);
      return null;
    }
    return buf;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /** Build a PaStreamParameters object for koffi to pass as a struct pointer */
  private _buildParams(opts: ResolvedAudioOptions, isInput: boolean): object {
    const deviceCount = Pa_GetDeviceCount();
    let device: number;

    if (opts.deviceId >= 0 && opts.deviceId < deviceCount) {
      device = opts.deviceId;
    } else {
      device = isInput ? Pa_GetDefaultInputDevice() : Pa_GetDefaultOutputDevice();
    }

    if (device === paNoDevice)
      throw new Error(`AudioIO: No default ${isInput ? 'input' : 'output'} device`);

    const devInfo = decodeDeviceInfo(Pa_GetDeviceInfo(device));
    console.log(`${isInput ? 'Input' : 'Output'} device: ${devInfo.name}`);

    const maxChannels = isInput ? devInfo.maxInputChannels : devInfo.maxOutputChannels;
    if (opts.channelCount > maxChannels)
      throw new Error(
        `AudioIO: channelCount ${opts.channelCount} exceeds device maximum ${maxChannels}`
      );

    const arch = process.arch;
    const useHigh = arch === 'arm' || arch === 'arm64';
    const suggestedLatency = isInput
      ? (useHigh ? devInfo.defaultHighInputLatency  : devInfo.defaultLowInputLatency)
      : (useHigh ? devInfo.defaultHighOutputLatency : devInfo.defaultLowOutputLatency);

    // Return a plain object; koffi marshals it as PaStreamParameters via the struct type
    return {
      device,
      channelCount:             opts.channelCount,
      sampleFormat:             getSampleFormat(opts.sampleFormat),
      suggestedLatency,
      hostApiSpecificStreamInfo: null,
    };
  }
}
