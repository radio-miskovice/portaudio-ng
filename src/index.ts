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
}

/** Returned when only `inOptions` is provided. */
export interface IoStreamRead extends IoStream, NodeJS.ReadableStream {}

/** Returned when only `outOptions` is provided. */
export interface IoStreamWrite extends IoStream, NodeJS.WritableStream {}

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
    });
  }

  // ── Control methods ──────────────────────────────────────────────────────

  const s = ioStream as typeof ioStream & IoStream;

  s.start = (): void => paCtx.start();

  s.quit = async (cb?: () => void): Promise<void> => {
    await paCtx.stop('WAIT' as StopFlag);
    if (paCtx.hasInput) endInput();
    if (typeof cb === 'function') cb();
  };

  s.abort = async (cb?: () => void): Promise<void> => {
    await paCtx.stop('ABORT' as StopFlag);
    if (paCtx.hasInput) endInput();
    if (typeof cb === 'function') cb();
  };

  // ── Lifecycle events ─────────────────────────────────────────────────────

  // 'close' → 'closed'  (preserved from original naudiodon API)
  ioStream.on('close', () => {
    ioStream.emit('closed');
  });

  // 'finish' fires when the Node Writable has processed all .write() chunks.
  // At that point PortAudio's internal ring buffer may still hold up to one
  // output-latency worth of audio.  Pa_StopStream(WAIT) — on a libuv thread —
  // blocks until the DAC physically emits the last sample.
  //
  // Event sequence:  'finish' → Pa_StopStream(WAIT) → 'finished'
  ioStream.on('finish', async () => {
    await paCtx.stop('WAIT');
    ioStream.emit('finished');
  });

  ioStream.on('error', (err: Error) => console.error('AudioIO:', err));

  return s as IoStreamRead | IoStreamWrite | IoStreamDuplex;
}
