/**
 * Low-level koffi bindings for the bundled PortAudio shared library.
 *
 * Responsibilities:
 *  - Load the correct platform binary from portaudio/bin/
 *  - Declare all C structs and PortAudio API functions with proper koffi types
 *  - Expose blocking I/O functions as Promises (run on libuv thread pool)
 *  - Provide typed getDevices() / getHostAPIs() wrappers
 *
 * The koffi struct definitions mirror portaudio.h exactly.
 * 'unsigned long' resolves to 4 bytes on Windows (Win64) and 8 bytes on LP64
 * platforms (Linux/macOS) — koffi handles this automatically.
 */
import * as koffi from 'koffi';
export interface DeviceInfo {
    readonly id: number;
    readonly name: string;
    readonly maxInputChannels: number;
    readonly maxOutputChannels: number;
    readonly defaultSampleRate: number;
    readonly defaultLowInputLatency: number;
    readonly defaultLowOutputLatency: number;
    readonly defaultHighInputLatency: number;
    readonly defaultHighOutputLatency: number;
    readonly hostAPIName: string;
}
export type HostApiType = 'InDevelopment' | 'DirectSound' | 'MME' | 'ASIO' | 'SoundManager' | 'CoreAudio' | 'OSS' | 'ALSA' | 'AL' | 'BeOS' | 'WDMKS' | 'JACK' | 'WASAPI' | 'AudioScienceHPI' | 'Unknown';
export interface HostApiInfo {
    readonly id: number;
    readonly name: string;
    readonly type: HostApiType;
    readonly deviceCount: number;
    readonly defaultInput: number;
    readonly defaultOutput: number;
}
export interface HostAPIsResult {
    readonly defaultHostAPI: number;
    readonly HostAPIs: HostApiInfo[];
}
export type PaStreamPtr = unknown;
interface PaVersionInfoDecoded {
    versionMajor: number;
    versionMinor: number;
    versionSubMinor: number;
    versionControlRevision: string;
    versionText: string;
}
interface PaDeviceInfoDecoded {
    structVersion: number;
    name: string;
    hostApi: number;
    maxInputChannels: number;
    maxOutputChannels: number;
    defaultLowInputLatency: number;
    defaultLowOutputLatency: number;
    defaultHighInputLatency: number;
    defaultHighOutputLatency: number;
    defaultSampleRate: number;
}
interface PaHostApiInfoDecoded {
    structVersion: number;
    type: number;
    name: string;
    deviceCount: number;
    defaultInputDevice: number;
    defaultOutputDevice: number;
}
interface PaStreamInfoDecoded {
    structVersion: number;
    inputLatency: number;
    outputLatency: number;
    sampleRate: number;
}
export declare const PaVersionInfoType: koffi.IKoffiCType;
export declare const PaDeviceInfoType: koffi.IKoffiCType;
export declare const PaHostApiInfoType: koffi.IKoffiCType;
export declare const PaStreamParametersType: koffi.IKoffiCType;
export declare const PaStreamInfoType: koffi.IKoffiCType;
export declare const paNoError = 0;
export declare const paInputOverflowed = -9981;
export declare const paOutputUnderflowed = -9980;
export declare const paNoDevice = -1;
export declare const paFormatIsSupported = 0;
export declare const paNoFlag = 0;
export declare const paFramesPerBufferUnspecified = 0;
/** naudiodon sampleFormat code → PortAudio PaSampleFormat flag value */
export declare const PA_FORMATS: Record<number, number>;
export declare const Pa_Initialize: () => number;
export declare const Pa_Terminate: () => number;
export declare const Pa_GetVersionInfo: () => unknown;
export declare const Pa_GetDeviceCount: () => number;
export declare const Pa_GetDefaultInputDevice: () => number;
export declare const Pa_GetDefaultOutputDevice: () => number;
export declare const Pa_GetDeviceInfo: (d: number) => unknown;
export declare const Pa_GetHostApiCount: () => number;
export declare const Pa_GetDefaultHostApi: () => number;
export declare const Pa_GetHostApiInfo: (i: number) => unknown;
export declare const Pa_GetErrorText: (c: number) => string;
export declare const Pa_IsFormatSupported: (inp: unknown, out: unknown, sr: number) => number;
export declare const Pa_OpenStream: (ref: unknown[], inp: unknown, out: unknown, sr: number, fpb: number, flags: number, cb: null, ud: null) => number;
export declare const Pa_CloseStream: (s: PaStreamPtr) => number;
export declare const Pa_GetStreamInfo: (s: PaStreamPtr) => unknown;
export declare const Pa_StartStream: (s: PaStreamPtr) => number;
export declare const Pa_StopStream_async: (s: PaStreamPtr) => Promise<number>;
export declare const Pa_AbortStream_async: (s: PaStreamPtr) => Promise<number>;
export declare const Pa_WriteStream_async: (s: PaStreamPtr, buf: Buffer, frames: number) => Promise<number>;
export declare const Pa_ReadStream_async: (s: PaStreamPtr, buf: Buffer, frames: number) => Promise<number>;
export declare function checkErr(code: number, context: string): void;
export declare function getSampleFormat(fmt: number): number;
declare function decodeVersionInfo(ptr: unknown): PaVersionInfoDecoded;
declare function decodeDeviceInfo(ptr: unknown): PaDeviceInfoDecoded;
declare function decodeHostApiInfo(ptr: unknown): PaHostApiInfoDecoded;
declare function decodeStreamInfo(ptr: unknown): PaStreamInfoDecoded;
export { decodeVersionInfo, decodeDeviceInfo, decodeHostApiInfo, decodeStreamInfo };
export declare function getDevices(): DeviceInfo[];
export declare function getHostAPIs(): HostAPIsResult;
//# sourceMappingURL=portaudio.d.ts.map