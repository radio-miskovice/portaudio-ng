"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaContext = void 0;
const portaudio_1 = require("./portaudio");
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
/** Number of bytes per single sample (NOT per frame) for a given sampleFormat */
function bytesPerSample(sampleFormat) {
    return sampleFormat === 1 ? 4 : sampleFormat / 8;
}
// ─────────────────────────────────────────────────────────────────────────────
// PaContext
// ─────────────────────────────────────────────────────────────────────────────
class PaContext {
    constructor(inOpts, outOpts) {
        this._stream = null;
        this._stopped = false;
        this._started = false;
        this._inOpts = inOpts;
        this._outOpts = outOpts;
        this._inBytesPerFrame = inOpts
            ? inOpts.channelCount * bytesPerSample(inOpts.sampleFormat)
            : 0;
        this._outBytesPerFrame = outOpts
            ? outOpts.channelCount * bytesPerSample(outOpts.sampleFormat)
            : 0;
    }
    get hasInput() { return this._inOpts !== null; }
    get hasOutput() { return this._outOpts !== null; }
    // ── Lifecycle ──────────────────────────────────────────────────────────────
    /**
     * Pa_Initialize + Pa_OpenStream (blocking/null-callback mode).
     * This is fast (< 1 ms on most systems) and safe to call synchronously.
     */
    open() {
        (0, portaudio_1.checkErr)((0, portaudio_1.Pa_Initialize)(), 'Pa_Initialize');
        const inOpts = this._inOpts;
        const outOpts = this._outOpts;
        if (inOpts && outOpts && inOpts.sampleRate !== outOpts.sampleRate) {
            (0, portaudio_1.Pa_Terminate)();
            throw new Error('AudioIO: Input and Output sample rates must match');
        }
        const sampleRate = (inOpts ?? outOpts).sampleRate;
        let inParams = null;
        let outParams = null;
        try {
            if (inOpts)
                inParams = this._buildParams(inOpts, true);
            if (outOpts)
                outParams = this._buildParams(outOpts, false);
        }
        catch (err) {
            (0, portaudio_1.Pa_Terminate)();
            throw err;
        }
        // framesPerBuffer: 0 = let PortAudio choose (optimal for blocking mode on all platforms)
        // ARM devices benefit from a fixed buffer to avoid underruns.
        const arch = process.arch;
        let framesPerBuffer = portaudio_1.paFramesPerBufferUnspecified;
        const inFpb = inOpts?.framesPerBuffer ?? 0;
        const outFpb = outOpts?.framesPerBuffer ?? 0;
        if (inFpb !== 0 || outFpb !== 0)
            framesPerBuffer = Math.max(inFpb, outFpb);
        if ((arch === 'arm' || arch === 'arm64') && framesPerBuffer === 0)
            framesPerBuffer = 256;
        // Verify format support
        const fmtCheck = (0, portaudio_1.Pa_IsFormatSupported)(inParams, outParams, sampleRate);
        if (fmtCheck !== portaudio_1.paFormatIsSupported) {
            (0, portaudio_1.Pa_Terminate)();
            throw new Error(`AudioIO: Format not supported: ${fmtCheck}`);
        }
        // Open in blocking mode — null for callback and userData
        const streamRef = [null];
        const openErr = (0, portaudio_1.Pa_OpenStream)(streamRef, inParams, outParams, sampleRate, framesPerBuffer, portaudio_1.paNoFlag, null, null);
        if (openErr !== portaudio_1.paNoError) {
            (0, portaudio_1.Pa_Terminate)();
            throw new Error(`AudioIO: Pa_OpenStream failed (${openErr})`);
        }
        this._stream = streamRef[0];
        // Log version and actual latency for diagnostics
        const verPtr = (0, portaudio_1.Pa_GetVersionInfo)();
        if (verPtr) {
            const ver = (0, portaudio_1.decodeVersionInfo)(verPtr);
            console.log(ver.versionText);
        }
        const infoPtr = (0, portaudio_1.Pa_GetStreamInfo)(this._stream);
        if (infoPtr) {
            const info = (0, portaudio_1.decodeStreamInfo)(infoPtr);
            if (inOpts)
                console.log(`Input  device latency: ${(info.inputLatency * 1000).toFixed(1)} ms`);
            if (outOpts)
                console.log(`Output device latency: ${(info.outputLatency * 1000).toFixed(1)} ms`);
        }
    }
    /** Pa_StartStream — must be called after open(). Idempotent. */
    start() {
        if (!this._stream)
            throw new Error('AudioIO: stream not opened');
        if (this._started)
            return;
        (0, portaudio_1.checkErr)((0, portaudio_1.Pa_StartStream)(this._stream), 'Pa_StartStream');
        this._started = true;
    }
    /**
     * Stop the stream and release all PortAudio resources.
     * - 'WAIT'  : Pa_StopStream — blocks on libuv thread until DAC drains (physically complete)
     * - 'ABORT' : Pa_AbortStream — discards pending audio immediately
     * Idempotent: safe to call more than once.
     */
    async stop(flag) {
        if (this._stopped)
            return;
        this._stopped = true;
        if (!this._stream)
            return;
        const stream = this._stream;
        this._stream = null; // prevent any new readChunk/writeChunk from starting
        if (this._started) {
            if (flag === 'ABORT')
                await (0, portaudio_1.Pa_AbortStream_async)(stream);
            else
                await (0, portaudio_1.Pa_StopStream_async)(stream); // blocks until the DAC emits the last sample
        }
        (0, portaudio_1.Pa_CloseStream)(stream);
        (0, portaudio_1.Pa_Terminate)();
    }
    // ── Blocking I/O ───────────────────────────────────────────────────────────
    /**
     * Write one chunk to the PortAudio output stream.
     * Pa_WriteStream blocks on a libuv worker thread; the event loop stays free.
     * Node's Writable backpressure naturally paces writes to the hardware rate.
     */
    async writeChunk(chunk) {
        if (!this._stream || this._stopped)
            return;
        if (!this._started)
            this.start();
        const frames = Math.floor(chunk.length / this._outBytesPerFrame);
        if (frames === 0)
            return;
        const err = await (0, portaudio_1.Pa_WriteStream_async)(this._stream, chunk, frames);
        if (err === portaudio_1.paOutputUnderflowed) {
            // Non-fatal: PA inserted silence; log and continue
            console.error('AudioIO: output underflow');
            return;
        }
        if (err !== portaudio_1.paNoError) {
            const msg = `Pa_WriteStream failed (${err})`;
            if (this._outOpts?.closeOnError !== false)
                throw new Error(msg);
            console.error(`AudioIO: ${msg}`);
        }
    }
    /**
     * Read one chunk from the PortAudio input stream into a new Buffer.
     * Pa_ReadStream blocks on a libuv worker thread; the event loop stays free.
     * Returns null when the stream is stopped.
     */
    async readChunk(numBytes) {
        if (!this._stream || this._stopped)
            return null;
        if (!this._started)
            this.start();
        const frames = Math.floor(numBytes / this._inBytesPerFrame);
        if (frames === 0)
            return null;
        const buf = Buffer.alloc(frames * this._inBytesPerFrame);
        const err = await (0, portaudio_1.Pa_ReadStream_async)(this._stream, buf, frames);
        // _stopped may have become true while we were blocked in Pa_ReadStream
        if (this._stopped)
            return null;
        if (err === portaudio_1.paInputOverflowed) {
            console.error('AudioIO: input overflow');
            return buf; // data is still valid even during overflow
        }
        if (err !== portaudio_1.paNoError) {
            const msg = `Pa_ReadStream failed (${err})`;
            if (this._inOpts?.closeOnError !== false)
                throw new Error(msg);
            console.error(`AudioIO: ${msg}`);
            return null;
        }
        return buf;
    }
    // ── Private ────────────────────────────────────────────────────────────────
    /** Build a PaStreamParameters object for koffi to pass as a struct pointer */
    _buildParams(opts, isInput) {
        const deviceCount = (0, portaudio_1.Pa_GetDeviceCount)();
        let device;
        if (opts.deviceId >= 0 && opts.deviceId < deviceCount) {
            device = opts.deviceId;
        }
        else {
            device = isInput ? (0, portaudio_1.Pa_GetDefaultInputDevice)() : (0, portaudio_1.Pa_GetDefaultOutputDevice)();
        }
        if (device === portaudio_1.paNoDevice)
            throw new Error(`AudioIO: No default ${isInput ? 'input' : 'output'} device`);
        const devInfo = (0, portaudio_1.decodeDeviceInfo)((0, portaudio_1.Pa_GetDeviceInfo)(device));
        console.log(`${isInput ? 'Input' : 'Output'} device: ${devInfo.name}`);
        const maxChannels = isInput ? devInfo.maxInputChannels : devInfo.maxOutputChannels;
        if (opts.channelCount > maxChannels)
            throw new Error(`AudioIO: channelCount ${opts.channelCount} exceeds device maximum ${maxChannels}`);
        const arch = process.arch;
        const useHigh = arch === 'arm' || arch === 'arm64';
        const suggestedLatency = isInput
            ? (useHigh ? devInfo.defaultHighInputLatency : devInfo.defaultLowInputLatency)
            : (useHigh ? devInfo.defaultHighOutputLatency : devInfo.defaultLowOutputLatency);
        // Return a plain object; koffi marshals it as PaStreamParameters via the struct type
        return {
            device,
            channelCount: opts.channelCount,
            sampleFormat: (0, portaudio_1.getSampleFormat)(opts.sampleFormat),
            suggestedLatency,
            hostApiSpecificStreamInfo: null,
        };
    }
}
exports.PaContext = PaContext;
//# sourceMappingURL=PaContext.js.map