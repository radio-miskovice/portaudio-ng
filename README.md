# portaudio-ng

Node.js streams backed by [PortAudio](http://portaudio.com/) v19.7.0 via [koffi](https://koffi.dev/) FFI  no native compilation required.

> **Compatibility note**  
> The public API is intentionally close to the original *naudiodon* package. Method names, option keys, event names, stream types and constant names are preserved. The main behavioural difference concerns `quit()` and `abort()`: see [Async differences](#async-differences) below.

---

## Platform support

The package ships prebuilt PortAudio binaries for:

| Platform | Architecture | Binary |
|---|---|---|
| Windows | x64 | `portaudio/bin/portaudio_x64.dll` |
| macOS | x64 / arm64 | `portaudio/bin/libportaudio.dylib` |
| Linux | x64 | `portaudio/bin/libportaudio.so.2` |
| Linux | armhf / arm64 | `portaudio/bin_armhf/libportaudio.so.2` |

No compilation step is needed. If your platform is not listed, install PortAudio system-wide and set the `PORTAUDIO_PATH` environment variable (planned feature - open an issue).

---

## Installation

```
npm install portaudio-ng
```

---

## Async differences from naudiodon

In *naudiodon*, `quit()` and `abort()` accepted an optional callback and returned `void`. In `portaudio-ng` they return a **`Promise<void>`**, because stopping the hardware stream (`Pa_StopStream` / `Pa_AbortStream`) is dispatched to the libuv thread pool so it never blocks the Node.js event loop.

**Consequences:**

- `await ao.quit()`  waits until the DAC has physically drained (all buffered samples have been emitted).
- `await ao.abort()`  waits until the stream has stopped (pending audio is discarded).
- The optional callback argument is still accepted for backward compatibility: it is called after the Promise resolves.
- Code that ignores the return value (`ao.quit()` without `await`) continues to work - the shutdown happens in the background and the stream emits `'finished'` when complete.
- `start()` is still **synchronous** (just calls `Pa_StartStream`). You may also omit calling `start()` - the first `write()` or `read()` will start the stream automatically.

Additionally, `portaudio-ng` makes the meaning of `'finished'` explicit: it fires **after** `Pa_StopStream(WAIT)` resolves, which means the last sample has physically left the DAC. This was also true in naudiodon but was not obvious from the name.

With `portaudio-ng`, `'finished'` is guaranteed to fire **before** the standard Node.js `'finish'` event, giving a clear ordering contract.

---

## ⚠️ The two-buffer problem

> **This is the most common source of audio being cut off at the end.**

There are two independent buffers between your code and the DAC:

1. **Node.js stream buffer** — holds chunks passed to `write()` that have not yet been handed to `_write()`.
2. **PortAudio ring buffer** — holds frames that have been written by `_write()` but not yet consumed by the hardware.

`await ao.quit()` (which calls `Pa_StopStream(WAIT)`) drains **buffer 2 only**.  
If you call `quit()` before buffer 1 has been flushed, the audio in buffer 1 is **silently discarded**.

### Incorrect patterns

```js
// ❌ WRONG — quit() races against the Node.js stream buffer:
ao.write(audioBuffer);
await ao.quit();   // audioBuffer may never reach PortAudio!

// ❌ WRONG — end() races for the same reason:
ao.write(audioBuffer);
ao.end();          // triggers 'finish' / _final before write is flushed
```

### Correct patterns

```js
// ✅ CORRECT — wait for the write callback (chunk flushed to PortAudio ring buffer):
await new Promise(resolve => ao.write(audioBuffer, resolve));
await ao.quit();

// ✅ CORRECT — use the first-class helper (does the above atomically):
await ao.playBuffer(audioBuffer);
```

The `playBuffer()` helper is the recommended approach for writing a complete buffer and waiting for DAC completion.

---

## Quick start

### Playing audio

```js
const fs = require('fs');
const { AudioIO, SampleFormat16Bit } = require('portaudio-ng');

const ao = AudioIO({
  outOptions: {
    channelCount: 2,
    sampleFormat: SampleFormat16Bit,
    sampleRate: 48000,
    deviceId: -1,       // -1 = system default
    closeOnError: true
  }
});

ao.on('finished', () => console.log('DAC drained — last sample emitted'));

fs.createReadStream('audio.wav').pipe(ao);
ao.start();
```

### Playing a Buffer directly

Use `playBuffer()` to write a complete in-memory buffer and wait for the DAC to drain — without worrying about the [two-buffer problem](#️-the-two-buffer-problem):

```js
const { AudioIO, SampleFormat16Bit } = require('portaudio-ng');

const ao = AudioIO({
  outOptions: { channelCount: 2, sampleFormat: SampleFormat16Bit, sampleRate: 44100 }
});
ao.start();

// audioBuffer is a Buffer of interleaved 16-bit PCM samples
await ao.playBuffer(audioBuffer);
// DAC has physically played the last sample — safe to exit
```

### Querying stream latency programmatically

Use `getStreamInfo()` to read the actual latency negotiated by PortAudio rather than relying on the value logged to stdout:

```js
ao.start();
const info = ao.getStreamInfo();
// info: { inputLatency: 0, outputLatency: 0.0914, sampleRate: 44100 }

// Dynamically size a silence trailer to ensure the ring buffer drains:
const trailingFrames = Math.ceil(info.outputLatency * info.sampleRate);
const bytesPerFrame  = 2 /* channels */ * 2 /* bytes per 16-bit sample */;
const silence        = Buffer.alloc(trailingFrames * bytesPerFrame);
await new Promise(resolve => ao.write(silence, resolve));
await ao.quit();
```

### Recording audio

```js
const fs = require('fs');
const { AudioIO, SampleFormat16Bit } = require('portaudio-ng');

const ai = AudioIO({
  inOptions: {
    channelCount: 2,
    sampleFormat: SampleFormat16Bit,
    sampleRate: 44100,
    deviceId: -1,
    closeOnError: true
  }
});

ai.pipe(fs.createWriteStream('recording.raw'));
ai.start();

process.on('SIGINT', async () => {
  await ai.quit();
  console.log('Recording stopped');
});
```

### Bi-directional (loopback)

```js
const { AudioIO, SampleFormat16Bit } = require('portaudio-ng');

const aio = AudioIO({
  inOptions:  { channelCount: 2, sampleFormat: SampleFormat16Bit, sampleRate: 44100, deviceId: -1 },
  outOptions: { channelCount: 2, sampleFormat: SampleFormat16Bit, sampleRate: 44100, deviceId: -1 }
});

aio.pipe(aio);   // loopback
aio.start();
```

---

## Listing devices and host APIs

```js
const { getDevices, getHostAPIs } = require('portaudio-ng');

console.log(getDevices());
// [{ id, name, maxInputChannels, maxOutputChannels, defaultSampleRate,
//    defaultLowInputLatency, defaultLowOutputLatency,
//    defaultHighInputLatency, defaultHighOutputLatency, hostAPIName }, ...]

console.log(getHostAPIs());
// { defaultHostAPI: 0, HostAPIs: [{ id, name, type, deviceCount, defaultInput, defaultOutput }, ...] }
```

---

## TypeScript

The package ships `.d.ts` declaration files compiled from the TypeScript source.

```ts
import { AudioIO, SampleFormat16Bit, type AudioOptions, type DeviceInfo } from 'portaudio-ng';
```

See [API.md](API.md) for the full type reference.

---

## License

MIT  see [LICENSE](LICENSE).

This package bundles prebuilt copies of the PortAudio library (v19.7.0).  
PortAudio is copyright (c) 1999-2011 Ross Bencina and Phil Burk, MIT-style license: http://www.portaudio.com/license.html
