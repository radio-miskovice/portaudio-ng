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
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Public domain types
// ─────────────────────────────────────────────────────────────────────────────

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

export type HostApiType =
  | 'InDevelopment' | 'DirectSound' | 'MME' | 'ASIO' | 'SoundManager'
  | 'CoreAudio' | 'OSS' | 'ALSA' | 'AL' | 'BeOS' | 'WDMKS' | 'JACK'
  | 'WASAPI' | 'AudioScienceHPI' | 'Unknown';

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

// Opaque pointer returned by Pa_OpenStream (void *)
export type PaStreamPtr = unknown;

// ─────────────────────────────────────────────────────────────────────────────
// Shapes of koffi-decoded C structs
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Library loading
// ─────────────────────────────────────────────────────────────────────────────

function resolveLibPath(): string {
  const platform = os.platform();
  const arch     = os.arch();
  const dir      = path.resolve(__dirname, '..', 'portaudio');

  if (platform === 'win32')                       return path.join(dir, 'bin',       'portaudio_x64.dll');
  if (platform === 'darwin')                      return path.join(dir, 'bin',       'libportaudio.dylib');
  if (arch === 'arm' || arch === 'arm64')         return path.join(dir, 'bin_armhf', 'libportaudio.so.2');
  return path.join(dir, 'bin', 'libportaudio.so.2');
}

const lib = koffi.load(resolveLibPath());

// ─────────────────────────────────────────────────────────────────────────────
// koffi struct definitions  (order and types mirror portaudio.h)
// ─────────────────────────────────────────────────────────────────────────────

export const PaVersionInfoType = koffi.struct('PaVersionInfo', {
  versionMajor:           'int',
  versionMinor:           'int',
  versionSubMinor:        'int',
  versionControlRevision: 'str',
  versionText:            'str',
});

export const PaDeviceInfoType = koffi.struct('PaDeviceInfo', {
  structVersion:           'int',
  name:                    'str',
  hostApi:                 'int',
  maxInputChannels:        'int',
  maxOutputChannels:       'int',
  defaultLowInputLatency:  'double',
  defaultLowOutputLatency: 'double',
  defaultHighInputLatency: 'double',
  defaultHighOutputLatency:'double',
  defaultSampleRate:       'double',
});

export const PaHostApiInfoType = koffi.struct('PaHostApiInfo', {
  structVersion:       'int',
  type:                'int',
  name:                'str',
  deviceCount:         'int',
  defaultInputDevice:  'int',
  defaultOutputDevice: 'int',
});

export const PaStreamParametersType = koffi.struct('PaStreamParameters', {
  device:                   'int',
  channelCount:             'int',
  sampleFormat:             'unsigned long',
  suggestedLatency:         'double',
  hostApiSpecificStreamInfo:'void *',
});

export const PaStreamInfoType = koffi.struct('PaStreamInfo', {
  structVersion: 'int',
  inputLatency:  'double',
  outputLatency: 'double',
  sampleRate:    'double',
});

// ─────────────────────────────────────────────────────────────────────────────
// PortAudio constants
// ─────────────────────────────────────────────────────────────────────────────

export const paNoError                   = 0;
export const paInputOverflowed           = -9981;
export const paOutputUnderflowed         = -9980;
export const paNoDevice                  = -1;
export const paFormatIsSupported         = 0;
export const paNoFlag                    = 0;
export const paFramesPerBufferUnspecified= 0;

/** naudiodon sampleFormat code → PortAudio PaSampleFormat flag value */
export const PA_FORMATS: Record<number, number> = {
  1:  0x00000001, // paFloat32
  8:  0x00000010, // paInt8
  16: 0x00000008, // paInt16
  24: 0x00000004, // paInt24 (packed)
  32: 0x00000002, // paInt32
};

const PA_HOST_API_TYPES: Record<number, HostApiType> = {
  0:  'InDevelopment',
  1:  'DirectSound',
  2:  'MME',
  3:  'ASIO',
  4:  'SoundManager',
  5:  'CoreAudio',
  7:  'OSS',
  8:  'ALSA',
  9:  'AL',
  10: 'BeOS',
  11: 'WDMKS',
  12: 'JACK',
  13: 'WASAPI',
  14: 'AudioScienceHPI',
};

// ─────────────────────────────────────────────────────────────────────────────
// Synchronous function bindings  (fast: init / enumeration / open / start)
// ─────────────────────────────────────────────────────────────────────────────

export const Pa_Initialize  = lib.func('int Pa_Initialize()') as () => number;
export const Pa_Terminate   = lib.func('int Pa_Terminate()')  as () => number;

export const Pa_GetVersionInfo = lib.func('const PaVersionInfo* Pa_GetVersionInfo()') as () => unknown;

export const Pa_GetDeviceCount         = lib.func('int Pa_GetDeviceCount()')          as () => number;
export const Pa_GetDefaultInputDevice  = lib.func('int Pa_GetDefaultInputDevice()')   as () => number;
export const Pa_GetDefaultOutputDevice = lib.func('int Pa_GetDefaultOutputDevice()')  as () => number;
export const Pa_GetDeviceInfo          = lib.func('const PaDeviceInfo* Pa_GetDeviceInfo(int device)')       as (d: number) => unknown;

export const Pa_GetHostApiCount   = lib.func('int Pa_GetHostApiCount()')              as () => number;
export const Pa_GetDefaultHostApi = lib.func('int Pa_GetDefaultHostApi()')            as () => number;
export const Pa_GetHostApiInfo    = lib.func('const PaHostApiInfo* Pa_GetHostApiInfo(int hostApi)')         as (i: number) => unknown;

export const Pa_GetErrorText = lib.func('const char* Pa_GetErrorText(int errorCode)') as (c: number) => string;

export const Pa_IsFormatSupported = lib.func(
  'int Pa_IsFormatSupported(const PaStreamParameters *inputParameters, const PaStreamParameters *outputParameters, double sampleRate)'
) as (inp: unknown, out: unknown, sr: number) => number;

// Pa_OpenStream in blocking (null-callback) mode.
// The first argument is PaStream** (an output pointer); koffi writes the result
// into index 0 of a JS array: const ref = [null]; Pa_OpenStream(ref, ...)
export const Pa_OpenStream = lib.func(
  'int Pa_OpenStream(_Out_ void **stream, const PaStreamParameters *inputParameters, const PaStreamParameters *outputParameters, double sampleRate, unsigned long framesPerBuffer, unsigned long streamFlags, void *streamCallback, void *userData)'
) as (ref: unknown[], inp: unknown, out: unknown, sr: number, fpb: number, flags: number, cb: null, ud: null) => number;

export const Pa_CloseStream   = lib.func('int Pa_CloseStream(void *stream)')      as (s: PaStreamPtr) => number;
export const Pa_GetStreamInfo = lib.func('const PaStreamInfo* Pa_GetStreamInfo(void *stream)') as (s: PaStreamPtr) => unknown;
export const Pa_StartStream   = lib.func('int Pa_StartStream(void *stream)')      as (s: PaStreamPtr) => number;

// ─────────────────────────────────────────────────────────────────────────────
// Async function bindings  (blocking — dispatched to libuv thread pool)
//
// koffi 2.x exposes func.async(...args, callback) for off-thread execution.
// util.promisify(func.async.bind(func)) converts to Promise<number>.
// ─────────────────────────────────────────────────────────────────────────────

const _Pa_StopStream  = lib.func('int Pa_StopStream(void *stream)');
const _Pa_AbortStream = lib.func('int Pa_AbortStream(void *stream)');
const _Pa_WriteStream = lib.func('int Pa_WriteStream(void *stream, const void *buffer, unsigned long frames)');
const _Pa_ReadStream  = lib.func('int Pa_ReadStream(void *stream, void *buffer, unsigned long frames)');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Pa_StopStream_async  = promisify(_Pa_StopStream.async.bind(_Pa_StopStream))   as (s: PaStreamPtr) => Promise<number>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Pa_AbortStream_async = promisify(_Pa_AbortStream.async.bind(_Pa_AbortStream)) as (s: PaStreamPtr) => Promise<number>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Pa_WriteStream_async = promisify(_Pa_WriteStream.async.bind(_Pa_WriteStream)) as (s: PaStreamPtr, buf: Buffer, frames: number) => Promise<number>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Pa_ReadStream_async  = promisify(_Pa_ReadStream.async.bind(_Pa_ReadStream))   as (s: PaStreamPtr, buf: Buffer, frames: number) => Promise<number>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function checkErr(code: number, context: string): void {
  if (code !== paNoError)
    throw new Error(`PortAudio ${context}: ${Pa_GetErrorText(code)}`);
}

export function getSampleFormat(fmt: number): number {
  const pf = PA_FORMATS[fmt];
  if (pf === undefined) throw new Error(`Invalid sampleFormat: ${fmt}`);
  return pf;
}

function decodeVersionInfo(ptr: unknown): PaVersionInfoDecoded {
  return koffi.decode(ptr, PaVersionInfoType) as PaVersionInfoDecoded;
}

function decodeDeviceInfo(ptr: unknown): PaDeviceInfoDecoded {
  return koffi.decode(ptr, PaDeviceInfoType) as PaDeviceInfoDecoded;
}

function decodeHostApiInfo(ptr: unknown): PaHostApiInfoDecoded {
  return koffi.decode(ptr, PaHostApiInfoType) as PaHostApiInfoDecoded;
}

function decodeStreamInfo(ptr: unknown): PaStreamInfoDecoded {
  return koffi.decode(ptr, PaStreamInfoType) as PaStreamInfoDecoded;
}

export { decodeVersionInfo, decodeDeviceInfo, decodeHostApiInfo, decodeStreamInfo };

// ─────────────────────────────────────────────────────────────────────────────
// High-level device / host-API enumeration  (synchronous — no stream open)
// ─────────────────────────────────────────────────────────────────────────────

export function getDevices(): DeviceInfo[] {
  checkErr(Pa_Initialize(), 'Pa_Initialize');
  try {
    const count = Pa_GetDeviceCount();
    const devices: DeviceInfo[] = [];
    for (let i = 0; i < count; i++) {
      const dev = decodeDeviceInfo(Pa_GetDeviceInfo(i));
      const api = decodeHostApiInfo(Pa_GetHostApiInfo(dev.hostApi));
      devices.push({
        id:                      i,
        name:                    dev.name,
        maxInputChannels:        dev.maxInputChannels,
        maxOutputChannels:       dev.maxOutputChannels,
        defaultSampleRate:       dev.defaultSampleRate,
        defaultLowInputLatency:  dev.defaultLowInputLatency,
        defaultLowOutputLatency: dev.defaultLowOutputLatency,
        defaultHighInputLatency: dev.defaultHighInputLatency,
        defaultHighOutputLatency:dev.defaultHighOutputLatency,
        hostAPIName:             api.name,
      });
    }
    return devices;
  } finally {
    Pa_Terminate();
  }
}

export function getHostAPIs(): HostAPIsResult {
  checkErr(Pa_Initialize(), 'Pa_Initialize');
  try {
    const defaultHostAPI = Pa_GetDefaultHostApi();
    const count          = Pa_GetHostApiCount();
    const HostAPIs: HostApiInfo[] = [];
    for (let i = 0; i < count; i++) {
      const info = decodeHostApiInfo(Pa_GetHostApiInfo(i));
      HostAPIs.push({
        id:            i,
        name:          info.name,
        type:          PA_HOST_API_TYPES[info.type] ?? 'Unknown',
        deviceCount:   info.deviceCount,
        defaultInput:  info.defaultInputDevice,
        defaultOutput: info.defaultOutputDevice,
      });
    }
    return { defaultHostAPI, HostAPIs };
  } finally {
    Pa_Terminate();
  }
}
