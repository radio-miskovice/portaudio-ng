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
import { getDevices, getHostAPIs } from './portaudio';
export { getDevices, getHostAPIs };
export type { DeviceInfo, HostApiInfo, HostAPIsResult, HostApiType } from './portaudio';
/** @deprecated Use HostApiInfo — alias for backward compatibility with naudiodon / naudiodon2 */
export type { HostApiInfo as HostInfo } from './portaudio';
/** 32-bit IEEE 754 floating point [-1.0, +1.0] */
export declare const SampleFormatFloat32: 1;
export declare const SampleFormat8Bit: 8;
export declare const SampleFormat16Bit: 16;
export declare const SampleFormat24Bit: 24;
export declare const SampleFormat32Bit: 32;
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
    readonly inputLatency: number;
    /** Actual output latency in seconds (0 for input-only streams). */
    readonly outputLatency: number;
    /** Actual sample rate negotiated with the device. */
    readonly sampleRate: number;
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
export interface IoStreamRead extends IoStream, NodeJS.ReadableStream {
}
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
export interface IoStreamDuplex extends IoStream, NodeJS.ReadableStream, NodeJS.WritableStream {
}
export declare function AudioIO(options: {
    inOptions: AudioOptions;
}): IoStreamRead;
export declare function AudioIO(options: {
    outOptions: AudioOptions;
}): IoStreamWrite;
export declare function AudioIO(options: {
    inOptions: AudioOptions;
    outOptions: AudioOptions;
}): IoStreamDuplex;
//# sourceMappingURL=index.d.ts.map