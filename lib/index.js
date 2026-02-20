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
        });
    }
    // ── Control methods ──────────────────────────────────────────────────────
    const s = ioStream;
    s.start = () => paCtx.start();
    s.quit = async (cb) => {
        await paCtx.stop('WAIT');
        if (paCtx.hasInput)
            endInput();
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
    ioStream.on('error', (err) => console.error('AudioIO:', err));
    return s;
}
//# sourceMappingURL=index.js.map