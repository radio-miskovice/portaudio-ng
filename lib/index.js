"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SampleFormat32Bit = exports.SampleFormat24Bit = exports.SampleFormat16Bit = exports.SampleFormat8Bit = exports.SampleFormatFloat32 = exports.getHostAPIs = exports.getDevices = void 0;
exports.AudioIO = AudioIO;
const stream_1 = require("stream");
const portaudio_1 = require("./portaudio");
Object.defineProperty(exports, "getDevices", { enumerable: true, get: function () { return portaudio_1.getDevices; } });
Object.defineProperty(exports, "getHostAPIs", { enumerable: true, get: function () { return portaudio_1.getHostAPIs; } });
const PaContext_1 = require("./PaContext");
// ─────────────────────────────────────────────────────────────────────────────
// Sample format constants
// ─────────────────────────────────────────────────────────────────────────────
/** 32-bit IEEE 754 floating point [-1.0, +1.0] */
exports.SampleFormatFloat32 = 1;
exports.SampleFormat8Bit = 8;
exports.SampleFormat16Bit = 16;
exports.SampleFormat24Bit = 24;
exports.SampleFormat32Bit = 32;
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
/** Fill in default values for user-supplied AudioOptions. */
function parseOpts(o) {
    if (!o)
        return null;
    return {
        deviceId: typeof o.deviceId === 'number' ? o.deviceId : -1,
        sampleRate: o.sampleRate ?? 44100,
        channelCount: o.channelCount ?? 2,
        sampleFormat: o.sampleFormat ?? 8,
        maxQueue: o.maxQueue ?? 2,
        framesPerBuffer: o.framesPerBuffer ?? 0,
        closeOnError: o.closeOnError !== false,
        highwaterMark: o.highwaterMark ?? 16384,
    };
}
function AudioIO(options) {
    const inOpts = parseOpts(options.inOptions ?? null);
    const outOpts = parseOpts(options.outOptions ?? null);
    if (!inOpts && !outOpts)
        throw new Error('AudioIO: inOptions and/or outOptions must be provided');
    // Open the PortAudio stream synchronously (< 1 ms: just initialises PA + opens device)
    const paCtx = new PaContext_1.PaContext(inOpts, outOpts);
    paCtx.open();
    // Guard: only push null once to a Readable
    let inputEnded = false;
    const endInput = () => {
        if (!inputEnded) {
            inputEnded = true;
            ioStream.push(null);
        }
    };
    // ── Node stream callbacks ────────────────────────────────────────────────
    /**
     * Readable._read — Pa_ReadStream blocks on a libuv thread; event loop free.
     */
    const doRead = async (size) => {
        try {
            const buf = await paCtx.readChunk(size);
            if (buf === null)
                endInput();
            else
                ioStream.push(buf);
        }
        catch (err) {
            ioStream.destroy(err);
        }
    };
    /**
     * Writable._write — Pa_WriteStream blocks on a libuv thread; event loop free.
     * Node's built-in backpressure paces writes to the hardware rate automatically.
     */
    const doWrite = async (chunk, _encoding, cb) => {
        try {
            await paCtx.writeChunk(chunk);
            cb();
        }
        catch (err) {
            cb(err);
        }
    };
    // ── Create the appropriate Node stream subclass ──────────────────────────
    // 'finished' must fire exactly once — whether triggered by end()/_final or
    // by a direct quit() call (e.g. from playBuffer).
    let finishedEmitted = false;
    const emitFinished = () => {
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
    const doFinal = async (cb) => {
        try {
            await paCtx.stop('WAIT');
            emitFinished();
            cb();
        }
        catch (err) {
            cb(err);
        }
    };
    let ioStream;
    if (inOpts && outOpts) {
        ioStream = new stream_1.Duplex({
            allowHalfOpen: false,
            readableObjectMode: false,
            writableObjectMode: false,
            readableHighWaterMark: inOpts.highwaterMark,
            writableHighWaterMark: outOpts.highwaterMark,
            read: doRead,
            write: doWrite,
            final: doFinal,
        });
    }
    else if (inOpts) {
        ioStream = new stream_1.Readable({
            highWaterMark: inOpts.highwaterMark,
            objectMode: false,
            read: doRead,
        });
    }
    else {
        ioStream = new stream_1.Writable({
            highWaterMark: outOpts.highwaterMark,
            decodeStrings: false,
            objectMode: false,
            write: doWrite,
            final: doFinal,
        });
    }
    // ── Control methods ──────────────────────────────────────────────────────
    const s = ioStream;
    s.start = () => paCtx.start();
    s.quit = async (cb) => {
        await paCtx.stop('WAIT');
        if (paCtx.hasInput)
            endInput();
        if (outOpts)
            emitFinished();
        if (typeof cb === 'function')
            cb();
    };
    s.abort = async (cb) => {
        await paCtx.stop('ABORT');
        if (paCtx.hasInput)
            endInput();
        if (typeof cb === 'function')
            cb();
    };
    s.getStreamInfo = () => paCtx.getStreamInfo();
    // playBuffer — write-only/duplex streams only
    if (outOpts) {
        s.playBuffer =
            (buffer) => new Promise((resolve, reject) => {
                // write() callback fires when the chunk has been flushed to
                // PortAudio's ring buffer (i.e., _write's cb has been called).
                // After that, quit() blocks via Pa_StopStream(WAIT) until the
                // DAC physically plays the last sample.
                const written = ioStream.write(buffer, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
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
    ioStream.on('error', (err) => console.error('AudioIO:', err));
    return s;
}
//# sourceMappingURL=index.js.map