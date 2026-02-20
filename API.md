# portaudio-ng — API Reference

Full TypeScript/JavaScript API specification.

---

## Contents

- [Sample format constants](#sample-format-constants)
- [getDevices()](#getdevices)
- [getHostAPIs()](#gethostapis)
- [AudioIO()](#audioio)
  - [AudioOptions](#audiooptions)
  - [IoStream (common methods)](#iostream-common-methods)
  - [IoStreamRead](#iostreamread)
  - [IoStreamWrite](#iostreamwrite)
  - [IoStreamDuplex](#iostreamduplex)
- [Event reference](#event-reference)
- [The two-buffer problem](#the-two-buffer-problem)
- [TypeScript type exports](#typescript-type-exports)

---

## Sample format constants

```ts
import {
  SampleFormatFloat32, // = 1  — 32-bit IEEE 754 float, range [-1.0, +1.0]
  SampleFormat8Bit,    // = 8  — unsigned 8-bit integer
  SampleFormat16Bit,   // = 16 — signed 16-bit integer (most common for PCM)
  SampleFormat24Bit,   // = 24 — signed 24-bit integer (packed)
  SampleFormat32Bit,   // = 32 — signed 32-bit integer
} from 'portaudio-ng';
```

Pass one of these values as `AudioOptions.sampleFormat`.

---

## getDevices()

```ts
function getDevices(): DeviceInfo[]
```

Returns an array describing every audio device known to PortAudio on the current machine. Each call re-enumerates the list.

### DeviceInfo

```ts
interface DeviceInfo {
  readonly id: number;                    // Zero-based device index, stable within a session
  readonly name: string;                  // Human-readable device name
  readonly maxInputChannels: number;      // 0 if output-only
  readonly maxOutputChannels: number;     // 0 if input-only
  readonly defaultSampleRate: number;     // Preferred sample rate in Hz
  readonly defaultLowInputLatency: number;    // Seconds — best for interactive use
  readonly defaultLowOutputLatency: number;
  readonly defaultHighInputLatency: number;   // Seconds — best for reliable playback
  readonly defaultHighOutputLatency: number;
  readonly hostAPIName: string;           // e.g. 'WASAPI', 'CoreAudio', 'ALSA'
}
```

### Example

```js
const { getDevices } = require('portaudio-ng');
const input  = getDevices().filter(d => d.maxInputChannels  > 0);
const output = getDevices().filter(d => d.maxOutputChannels > 0);
console.log('Input devices:',  input.map(d => `${d.id}: ${d.name}`));
console.log('Output devices:', output.map(d => `${d.id}: ${d.name}`));
```

---

## getHostAPIs()

```ts
function getHostAPIs(): HostAPIsResult
```

Returns the set of host audio APIs available on the current platform (e.g. WASAPI, MME, ASIO on Windows; CoreAudio on macOS; ALSA, JACK on Linux).

### HostAPIsResult

```ts
interface HostAPIsResult {
  readonly defaultHostAPI: number;   // Index into HostAPIs[] for the platform default
  readonly HostAPIs: HostApiInfo[];
}
```

### HostApiInfo

```ts
interface HostApiInfo {
  readonly id: number;
  readonly name: string;
  readonly type: HostApiType;        // See below
  readonly deviceCount: number;
  readonly defaultInput: number;     // Device id of the default input for this host API
  readonly defaultOutput: number;    // Device id of the default output for this host API
}

// HostInfo is exported as a deprecated alias for backward compatibility
type HostInfo = HostApiInfo;
```

### HostApiType

```ts
type HostApiType =
  | 'InDevelopment'
  | 'DirectSound'
  | 'MME'
  | 'ASIO'
  | 'SoundManager'
  | 'CoreAudio'
  | 'OSS'
  | 'ALSA'
  | 'AL'
  | 'BeOS'
  | 'WDMKS'
  | 'JACK'
  | 'WASAPI'
  | 'AudioScienceHPI'
  | 'Unknown';
```

---

## AudioIO()

```ts
function AudioIO(options: { inOptions:  AudioOptions }): IoStreamRead
function AudioIO(options: { outOptions: AudioOptions }): IoStreamWrite
function AudioIO(options: { inOptions: AudioOptions; outOptions: AudioOptions }): IoStreamDuplex
```

Factory function — **not** a constructor; do not use `new`. Returns one of three Node.js stream subclasses depending on which options are provided:

| Options supplied | Return type | Node.js base class |
|---|---|---|
| `outOptions` only | `IoStreamWrite` | `stream.Writable` |
| `inOptions` only | `IoStreamRead` | `stream.Readable` |
| both | `IoStreamDuplex` | `stream.Duplex` |

The PortAudio stream is opened (but not started) synchronously inside `AudioIO()`. This takes less than 1 ms on most systems.

### AudioOptions

All fields are optional; defaults are shown.

```ts
interface AudioOptions {
  /** Device index from getDevices(). -1 selects the system default. Default: -1 */
  deviceId?: number;

  /** Sample rate in Hz. For full-duplex, inOptions and outOptions must use the same rate. Default: 44100 */
  sampleRate?: number;

  /** Number of interleaved audio channels. Default: 2 */
  channelCount?: number;

  /** Sample encoding. Use one of the SampleFormat* constants. Default: SampleFormat8Bit (8) */
  sampleFormat?: 1 | 8 | 16 | 24 | 32;

  /** Number of audio blocks to buffer internally. Default: 2 */
  maxQueue?: number;

  /**
   * Preferred block granularity in frames. 0 lets PortAudio choose the optimal
   * value for the host API. Non-zero values add a buffering layer and latency.
   * Default: 0
   */
  framesPerBuffer?: number;

  /** Node.js stream high-water mark in bytes. Default: 16384 */
  highwaterMark?: number;

  /**
   * When true, an audio xrun (underflow / overflow) destroys the stream with an
   * error. When false the error is logged and streaming continues. Default: true
   */
  closeOnError?: boolean;
}
```

---

## IoStream (common methods)

All three stream types expose these methods in addition to the standard Node.js stream API.

### start()

```ts
start(): void
```

Starts audio I/O on the hardware device. Call after attaching all event listeners. Calling `start()` is optional — the stream auto-starts on the first `write()` or `read()` call.

### quit()

```ts
quit(callback?: () => void): Promise<void>
```

Graceful shutdown. Waits for PortAudio to drain its internal buffer so that every buffered sample is physically emitted by the DAC before resolving. The optional `callback` is invoked after the Promise resolves (backward-compatible pattern).

After `quit()` resolves the stream emits `'finished'`.

```js
// await pattern (recommended)
await ao.quit();

// callback pattern (backward-compatible)
ao.quit(() => console.log('done'));

// fire-and-forget — 'finished' will still be emitted
ao.quit();
```

### abort()

```ts
abort(callback?: () => void): Promise<void>
```

Immediate shutdown. Discards any audio still in PortAudio's ring buffer and stops the hardware stream as fast as possible. The optional `callback` is invoked after the Promise resolves.

```js
await ao.abort();
```

### getStreamInfo()

```ts
getStreamInfo(): StreamInfo | null
```

Returns the actual stream parameters negotiated by PortAudio after the stream was opened, or `null` if the stream has not been opened yet. Use this to dynamically size silence trailers or adjust timing instead of relying on the latency logged to stdout.

```ts
interface StreamInfo {
  readonly inputLatency:  number;  // seconds; 0 for output-only streams
  readonly outputLatency: number;  // seconds; 0 for input-only streams
  readonly sampleRate:    number;  // actual rate negotiated with device
}
```

```js
ao.start();
const { outputLatency, sampleRate } = ao.getStreamInfo();
const trailingFrames = Math.ceil(outputLatency * sampleRate);
const silence = Buffer.alloc(trailingFrames * channelCount * bytesPerSample);
await new Promise(resolve => ao.write(silence, resolve));
await ao.quit();
```

---

## IoStreamRead

Extends `IoStream` and `stream.Readable`. Returned when only `inOptions` is supplied.

```ts
interface IoStreamRead extends IoStream, NodeJS.ReadableStream {}
```

Use the standard Readable API — `pipe()`, `'data'` events, etc. Call `start()` (or just call `pipe()` which will trigger auto-start on first `read()`) then call `quit()` or `abort()` when done.

```js
const ai = AudioIO({ inOptions: { channelCount: 1, sampleFormat: SampleFormat16Bit, sampleRate: 44100 } });
ai.pipe(someWritableStream);
ai.start();
```

---

## IoStreamWrite

Extends `IoStream` and `stream.Writable`. Returned when only `outOptions` is supplied.

```ts
interface IoStreamWrite extends IoStream, NodeJS.WritableStream {
  playBuffer(buffer: Buffer): Promise<void>;
}
```

Write PCM audio buffers with `write()` / `end()` or pipe from a Readable. Back-pressure is handled automatically — `write()` respects `highwaterMark` and the `'drain'` event fires when the internal buffer drains below the high-water mark.

```js
const ao = AudioIO({ outOptions: { channelCount: 2, sampleFormat: SampleFormat16Bit, sampleRate: 44100 } });
ao.on('finished', () => console.log('DAC drained — last sample emitted'));
someReadableStream.pipe(ao);
ao.start();
```

### playBuffer()

```ts
playBuffer(buffer: Buffer): Promise<void>
```

Convenience method: write `buffer` to the output stream and wait for the DAC to physically play the last sample.  Equivalent to:

```js
await new Promise(resolve => ao.write(buffer, resolve));
await ao.quit();
```

This is the **recommended** way to play a complete in-memory audio buffer.  It avoids the [two-buffer problem](#the-two-buffer-problem) entirely and the `'finished'` event fires just before this Promise resolves.

```js
const ao = AudioIO({ outOptions: { channelCount: 2, sampleFormat: SampleFormat16Bit, sampleRate: 44100 } });
ao.start();
await ao.playBuffer(pcmBuffer);
// The DAC has physically played the last sample — safe to exit
```

---

## IoStreamDuplex

Extends `IoStream`, `stream.Readable`, and `stream.Writable`. Returned when both `inOptions` and `outOptions` are supplied. Both sample rates must be equal.

```ts
interface IoStreamDuplex extends IoStream, NodeJS.ReadableStream, NodeJS.WritableStream {}
```

---

## Event reference

All events are emitted on the stream object returned by `AudioIO()`.

| Event | Stream type | When |
|---|---|---|
| `'data'` | Read, Duplex | A buffer of PCM audio was read from the device. Standard Readable event. |
| `'end'` | Read, Duplex | The input stream has no more data (stream stopped). |
| `'drain'` | Write, Duplex | The internal write buffer has been flushed; safe to write more data. |
| `'finish'` | Write, Duplex | All `write()` calls have been processed by the Node.js stream layer **and** `Pa_StopStream(WAIT)` has returned. Fires after `'finished'`. |
| `'finished'` | Write, Duplex | `Pa_StopStream(WAIT)` has returned — the last sample has physically been emitted by the DAC. Fires **before** the standard `'finish'` event. |
| `'close'` | All | The underlying stream resource has been closed. |
| `'closed'` | All | Alias emitted immediately after `'close'` (backward-compatible). |
| `'error'` | All | An error occurred. The error is also logged to `console.error`. |

### Playback event sequence

```
write() ... end()
  → _final()              (Node.js Writable: all chunks processed by _write)
  → Pa_StopStream(WAIT)   (blocks on libuv thread until DAC drains)
  → 'finished'            (last sample emitted by hardware)
  → 'finish'              (Node.js Writable: stream fully closed)
```

`'finished'` is guaranteed to fire **before** `'finish'` — subscribing to `'finished'` gives you the earliest possible notification that the DAC is silent.

---

## The two-buffer problem

> **This is the most common source of audio being cut off silently at the end.**

There are two independent buffers in the output path:

1. **Node.js stream buffer** — holds chunks passed to `write()` that have not yet been handed to `_write()` (gated by `highwaterMark`).
2. **PortAudio ring buffer** — holds PCM frames that `_write()` has submitted but the hardware has not yet consumed.

`await ao.quit()` (which calls `Pa_StopStream(WAIT)`) drains **only buffer 2**.
If buffer 1 still holds data when you call `quit()`, that audio is **silently discarded**.

| Pattern | Safe? | Reason |
|---|---|---|
| `ao.write(buf); await ao.quit()` | ❌ | `quit()` races against buffer 1 |
| `ao.write(buf); ao.end()` | ❌ | `end()` triggers `_final` before `buf` is flushed |
| `await new Promise(r => ao.write(buf, r)); await ao.quit()` | ✅ | Waits for buffer 1 to flush to PortAudio |
| `await ao.playBuffer(buf)` | ✅ | First-class helper — same guarantee |

The `write()` callback fires only after the chunk reaches PortAudio's ring buffer.  Once that callback fires, `Pa_StopStream(WAIT)` is safe to call.

---

## TypeScript type exports

```ts
import type {
  AudioOptions,       // Options passed to AudioIO()
  IoStream,           // Common methods: start / quit / abort / getStreamInfo
  IoStreamRead,       // Readable stream type
  IoStreamWrite,      // Writable stream type (adds playBuffer)
  IoStreamDuplex,     // Duplex stream type
  StreamInfo,         // { inputLatency, outputLatency, sampleRate } — from getStreamInfo()
  DeviceInfo,         // Shape of objects returned by getDevices()
  HostApiInfo,        // Shape of objects in getHostAPIs().HostAPIs
  HostInfo,           // Deprecated alias for HostApiInfo (backward compat)
  HostAPIsResult,     // Return type of getHostAPIs()
  HostApiType,        // Union of host API name strings
} from 'portaudio-ng';
```
