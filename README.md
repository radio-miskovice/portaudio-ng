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
ao.on('finished',         () => console.log('Stream closed'));

fs.createReadStream('audio.wav').pipe(ao);
ao.start();
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
