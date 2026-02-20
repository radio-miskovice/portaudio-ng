/**
 * portaudio-ng — Node.js streams backed by PortAudio's blocking I/O API via koffi.
 *
 * Public API is compatible with the original naudiodon package.
 * The 'finished' event fires after Pa_StopStream(WAIT) resolves, guaranteeing
 * that the last sample has physically been emitted by the DAC.
 *
 * Usage example:
 *
 *   import { AudioIO, SampleFormat16Bit } from 'portaudio-ng';
 *   import { createReadStream } from 'fs';
 *
 *   const ao = AudioIO({ outOptions: { channelCount: 2, sampleFormat: SampleFormat16Bit, sampleRate: 44100 } });
 *   ao.on('finished', () => console.log('DAC done'));
 *   ao.start();
 *   createReadStream('audio.wav').pipe(ao);
 */

import { Readable, Writable, Duplex } from 'stream';
import { getDevices, getHostAPIs }    from './portaudio';
import { PaContext, type ResolvedAudioOptions, type StopFlag } from './PaContext';

export { getDevices, getHostAPIs };
export type { DeviceInfo, HostApiInfo, HostAPIsResult, HostApiType } from './portaudio';
/** @deprecated Use HostApiInfo — alias for backward compatibility with naudiodon / naudiodon2 */
export type { HostApiInfo as HostInfo } from './portaudio';

// ─────────────────────────────────────────────────────────────────────────────
// Sample format constants
// ─────────────────────────────────────────────────────────────────────────────

/** 32-bit IEEE 754 floating point [-1.0, +1.0] */
export const SampleFormatFloat32 = 1  as const;
export const SampleFormat8Bit    = 8  as const;
export const SampleFormat16Bit   = 16 as const;
export const SampleFormat24Bit   = 24 as const;
export const SampleFormat32Bit   = 32 as const;

// ─────────────────────────────────────────────────────────────────────────────
// Public API types
// ─────────────────────────────────────────────────────────────────────────────

export interface AudioOptions {
  /** Device index; omit or pass -1 to use the system default. */
  deviceId?: number;
  /** Sample rate in Hz (default: 44100). For full-duplex must match in and out. */
  sampleRate?: number;
  /** Number of interleaved audio channels (default: 2). */
  channelCount?: number;
  /** Bits per sample / sample encoding (default: 8). */
  sampleFormat?: 1 | 8 | 16 | 24 | 32;
  /** Maximum number of audio blocks to buffer (default: 2). */
  maxQueue?: number;
  /**
   * Preferred block granularity in frames (default: 0 = let PortAudio choose).
   * Non-zero values may add latency on some host APIs; only set when required.
   */
  framesPerBuffer?: number;
  /** Node.js stream high-water mark in bytes (default: 16384). */
  highwaterMark?: number;
  /** Destroy the stream on audio xrun errors (default: true). */
  closeOnError?: boolean;
}

/**
 * Actual stream parameters negotiated by PortAudio after the stream is opened.
 * Returned by `getStreamInfo()`.
 */
export interface StreamInfo {
  /** Actual input latency in seconds (0 for output-only streams). */
  readonly inputLatency:  number;
  /** Actual output latency in seconds (0 for input-only streams). */
  readonly outputLatency: number;
  /** Actual sample rate negotiated with the device. */
  readonly sampleRate:    number;
}

/**
 * Methods added by AudioIO to every returned Node.js stream.
 * Call `start()` after attaching all event listeners.
 */
export interface IoStream {
  /** Begin audio I/O.  Call after all event listeners are attached. */
  start(): void;
  /**
   * Graceful shutdown: flush pending output, then stop hardware.
   * Resolves when hardware is idle; fires 'playbackComplete' (output only)
   * then 'finished'.
   */
  quit(callback?: () => void): Promise<void>;
  /**
   * Immediate shutdown: discard buffered audio and stop hardware immediately.
   * Resolves when the stream is idle.
   */
  abort(callback?: () => void): Promise<void>;
  /**
   * Returns the actual latency and sample rate negotiated by PortAudio for
   * this stream, or null if the stream has not been opened yet.
   * Use this to dynamically size trailing silence instead of hardcoding a
   * delay based on a logged message.
   */
  getStreamInfo(): StreamInfo | null;
}

/** Returned when only `inOptions` is provided. */
export interface IoStreamRead extends IoStream, NodeJS.ReadableStream {}

/**
 * Returned when only `outOptions` is provided.
 *
 * ### Writing audio
 *
 * `write()` follows the standard Node.js `Writable` contract:
 * - Returns `false` when the internal buffer is full (backpressure); listen for
 *   `'drain'` before writing more.
 * - The optional callback fires once the chunk has been **flushed to the
 *   PortAudio ring buffer** — not when the DAC has played it.
 *
 * ### Correct pattern for writing a buffer and waiting for DAC completion
 *
 * ```js
 * // WRONG — quit() races against the Node.js stream buffer:
 * ao.write(audioBuffer);
 * await ao.quit();   // may cut off audio early!
 *
 * // CORRECT — wait for the write callback before calling quit():
 * await new Promise(resolve => ao.write(audioBuffer, resolve));
 * await ao.quit();   // now guaranteed to drain
 *
 * // OR — use the first-class helper:
 * await ao.playBuffer(audioBuffer);
 * ```
 *
 * See also the README section "The two-buffer problem".
 */
export interface IoStreamWrite extends IoStream, NodeJS.WritableStream {
  /**
   * Write `buffer` to the output stream and wait for the DAC to physically
   * play the last sample.
   *
   * Equivalent to:
   * ```js
   * await new Promise(resolve => ao.write(buffer, resolve));
   * await ao.quit();
   * ```
   *
   * Resolves only after `Pa_StopStream(WAIT)` completes (the same guarantee as
   * `await ao.quit()`).  The `'finished'` event fires just before this Promise
   * resolves.
   */
  playBuffer(buffer: Buffer): Promise<void>;
}

/** Returned when both `inOptions` and `outOptions` are provided. */
export interface IoStreamDuplex extends IoStream, NodeJS.ReadableStream, NodeJS.WritableStream {}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Fill in default values for user-supplied AudioOptions. */
function parseOpts(o: AudioOptions | undefined | null): ResolvedAudioOptions | null {
  if (!o) return null;
  return {
    deviceId:        typeof o.deviceId === 'number' ? o.deviceId : -1,
    sampleRate:      o.sampleRate      ?? 44100,
    channelCount:    o.channelCount    ?? 2,
    sampleFormat:    o.sampleFormat    ?? 8,
    maxQueue:        o.maxQueue        ?? 2,
    framesPerBuffer: o.framesPerBuffer ?? 0,
    closeOnError:    o.closeOnError    !== false,
    highwaterMark:   o.highwaterMark   ?? 16384,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AudioIO factory — overloaded signatures
// ─────────────────────────────────────────────────────────────────────────────

export function AudioIO(options: { inOptions: AudioOptions }): IoStreamRead;
export function AudioIO(options: { outOptions: AudioOptions }): IoStreamWrite;
export function AudioIO(options: { inOptions: AudioOptions; outOptions: AudioOptions }): IoStreamDuplex;
export function AudioIO(
  options: { inOptions?: AudioOptions; outOptions?: AudioOptions },
): IoStreamRead | IoStreamWrite | IoStreamDuplex {

  const inOpts  = parseOpts(options.inOptions  ?? null);
  const outOpts = parseOpts(options.outOptions ?? null);

  if (!inOpts && !outOpts)
    throw new Error('AudioIO: inOptions and/or outOptions must be provided');

  // Open the PortAudio stream synchronously (< 1 ms: just initialises PA + opens device)
  const paCtx = new PaContext(inOpts, outOpts);
  paCtx.open();

  // Guard: only push null once to a Readable
  let inputEnded = false;
  const endInput = (): void => {
    if (!inputEnded) {
      inputEnded = true;
      (ioStream as Readable).push(null);
    }
  };

  // ── Node stream callbacks ────────────────────────────────────────────────

  /**
   * Readable._read — Pa_ReadStream blocks on a libuv thread; event loop free.
   */
  const doRead = async (size: number): Promise<void> => {
    try {
      const buf = await paCtx.readChunk(size);
      if (buf === null) endInput();
      else              (ioStream as Readable).push(buf);
    } catch (err) {
      (ioStream as Readable).destroy(err as Error);
    }
  };

  /**
   * Writable._write — Pa_WriteStream blocks on a libuv thread; event loop free.
   * Node's built-in backpressure paces writes to the hardware rate automatically.
   */
  const doWrite = async (chunk: Buffer, _encoding: string, cb: (err?: Error | null) => void): Promise<void> => {
    try {
      await paCtx.writeChunk(chunk);
      cb();
    } catch (err) {
      cb(err as Error);
    }
  };

  // ── Create the appropriate Node stream subclass ──────────────────────────

  // 'finished' must fire exactly once — whether triggered by end()/_final or
  // by a direct quit() call (e.g. from playBuffer).
  let finishedEmitted = false;
  const emitFinished = (): void => {
    if (!finishedEmitted) {
      finishedEmitted = true;
      ioStream.emit('finished');
    }
  };

  // For output (Writable / Duplex), we implement _final() rather than listening
  // to 'finish'.  _final(cb) is called after the last _write() completes but
  // BEFORE 'finish' fires — so Pa_StopStream(WAIT) runs while Node.js still
  // considers the stream open, eliminating the race between the Node.js stream
  // teardown and PortAudio consuming its ring buffer.
  const doFinal = async (cb: (err?: Error | null) => void): Promise<void> => {
    try {
      await paCtx.stop('WAIT');
      emitFinished();
      cb();
    } catch (err) {
      cb(err as Error);
    }
  };

  let ioStream: Readable | Writable | Duplex;
  if (inOpts && outOpts) {
    ioStream = new Duplex({
      allowHalfOpen:         false,
      readableObjectMode:    false,
      writableObjectMode:    false,
      readableHighWaterMark: inOpts.highwaterMark,
      writableHighWaterMark: outOpts.highwaterMark,
      read:  doRead,
      write: doWrite,
      final: doFinal,
    });
  } else if (inOpts) {
    ioStream = new Readable({
      highWaterMark: inOpts.highwaterMark,
      objectMode:    false,
      read:          doRead,
    });
  } else {
    ioStream = new Writable({
      highWaterMark:  outOpts!.highwaterMark,
      decodeStrings:  false,
      objectMode:     false,
      write:          doWrite,
      final:          doFinal,
    });
  }

  // ── Control methods ──────────────────────────────────────────────────────

  const s = ioStream as typeof ioStream & IoStream & { playBuffer?: (b: Buffer) => Promise<void> };

  s.start = (): void => paCtx.start();

  s.quit = async (cb?: () => void): Promise<void> => {
    await paCtx.stop('WAIT' as StopFlag);
    if (paCtx.hasInput) endInput();
    if (outOpts) emitFinished();
    if (typeof cb === 'function') cb();
  };

  s.abort = async (cb?: () => void): Promise<void> => {
    await paCtx.stop('ABORT' as StopFlag);
    if (paCtx.hasInput) endInput();
    if (typeof cb === 'function') cb();
  };

  s.getStreamInfo = (): StreamInfo | null => paCtx.getStreamInfo();

  // playBuffer — write-only/duplex streams only
  if (outOpts) {
    (s as typeof s & { playBuffer: (b: Buffer) => Promise<void> }).playBuffer =
      (buffer: Buffer): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          // write() callback fires when the chunk has been flushed to
          // PortAudio's ring buffer (i.e., _write's cb has been called).
          // After that, quit() blocks via Pa_StopStream(WAIT) until the
          // DAC physically plays the last sample.
          const written = (ioStream as Writable).write(buffer, (err) => {
            if (err) { reject(err); return; }
            s.quit().then(resolve, reject);
          });
          // If write() returned false (backpressure), the callback above will
          // still fire once the chunk is processed — no extra action needed here.
          void written;
        });
  }

  // ── Lifecycle events ─────────────────────────────────────────────────────

  // 'close' → 'closed'  (preserved from original naudiodon API)
  ioStream.on('close', () => {
    ioStream.emit('closed');
  });

  // For output streams, Pa_StopStream(WAIT) is now called from _final() which
  // runs before 'finish' fires — the 'finished' event is emitted from there,
  // or from quit() if called directly.
  // For input-only streams there is no _final(); emit 'finished' on 'end'.
  if (!outOpts) {
    ioStream.on('end', () => {
      emitFinished();
    });
  }

  ioStream.on('error', (err: Error) => console.error('AudioIO:', err));

  return s as unknown as IoStreamRead | IoStreamWrite | IoStreamDuplex;
}
