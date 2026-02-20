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
/** Internal: AudioOptions with all defaults resolved */
export interface ResolvedAudioOptions {
    deviceId: number;
    sampleRate: number;
    channelCount: number;
    sampleFormat: 1 | 8 | 16 | 24 | 32;
    maxQueue: number;
    framesPerBuffer: number;
    closeOnError: boolean;
    highwaterMark: number;
}
export type StopFlag = 'WAIT' | 'ABORT';
export declare class PaContext {
    private readonly _inOpts;
    private readonly _outOpts;
    private _stream;
    private _stopped;
    private _started;
    private readonly _inBytesPerFrame;
    private readonly _outBytesPerFrame;
    constructor(inOpts: ResolvedAudioOptions | null, outOpts: ResolvedAudioOptions | null);
    get hasInput(): boolean;
    get hasOutput(): boolean;
    /**
     * Pa_Initialize + Pa_OpenStream (blocking/null-callback mode).
     * This is fast (< 1 ms on most systems) and safe to call synchronously.
     */
    open(): void;
    /** Pa_StartStream — must be called after open(). Idempotent. */
    start(): void;
    /**
     * Stop the stream and release all PortAudio resources.
     * - 'WAIT'  : Pa_StopStream — blocks on libuv thread until DAC drains (physically complete)
     * - 'ABORT' : Pa_AbortStream — discards pending audio immediately
     * Idempotent: safe to call more than once.
     */
    stop(flag: StopFlag): Promise<void>;
    /**
     * Write one chunk to the PortAudio output stream.
     * Pa_WriteStream blocks on a libuv worker thread; the event loop stays free.
     * Node's Writable backpressure naturally paces writes to the hardware rate.
     */
    writeChunk(chunk: Buffer): Promise<void>;
    /**
     * Read one chunk from the PortAudio input stream into a new Buffer.
     * Pa_ReadStream blocks on a libuv worker thread; the event loop stays free.
     * Returns null when the stream is stopped.
     */
    readChunk(numBytes: number): Promise<Buffer | null>;
    /** Build a PaStreamParameters object for koffi to pass as a struct pointer */
    private _buildParams;
}
//# sourceMappingURL=PaContext.d.ts.map