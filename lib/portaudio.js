"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pa_ReadStream_async = exports.Pa_WriteStream_async = exports.Pa_AbortStream_async = exports.Pa_StopStream_async = exports.Pa_StartStream = exports.Pa_GetStreamInfo = exports.Pa_CloseStream = exports.Pa_OpenStream = exports.Pa_IsFormatSupported = exports.Pa_GetErrorText = exports.Pa_GetHostApiInfo = exports.Pa_GetDefaultHostApi = exports.Pa_GetHostApiCount = exports.Pa_GetDeviceInfo = exports.Pa_GetDefaultOutputDevice = exports.Pa_GetDefaultInputDevice = exports.Pa_GetDeviceCount = exports.Pa_GetVersionInfo = exports.Pa_Terminate = exports.Pa_Initialize = exports.PA_FORMATS = exports.paFramesPerBufferUnspecified = exports.paNoFlag = exports.paFormatIsSupported = exports.paNoDevice = exports.paOutputUnderflowed = exports.paInputOverflowed = exports.paNoError = exports.PaStreamInfoType = exports.PaStreamParametersType = exports.PaHostApiInfoType = exports.PaDeviceInfoType = exports.PaVersionInfoType = void 0;
exports.checkErr = checkErr;
exports.getSampleFormat = getSampleFormat;
exports.decodeVersionInfo = decodeVersionInfo;
exports.decodeDeviceInfo = decodeDeviceInfo;
exports.decodeHostApiInfo = decodeHostApiInfo;
exports.decodeStreamInfo = decodeStreamInfo;
exports.getDevices = getDevices;
exports.getHostAPIs = getHostAPIs;
const koffi = __importStar(require("koffi"));
const util_1 = require("util");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
// ─────────────────────────────────────────────────────────────────────────────
// Library loading
// ─────────────────────────────────────────────────────────────────────────────
function resolveLibPath() {
    const platform = os.platform();
    const arch = os.arch();
    const dir = path.resolve(__dirname, '..', 'portaudio');
    if (platform === 'win32')
        return path.join(dir, 'bin', 'portaudio_x64.dll');
    if (platform === 'darwin')
        return path.join(dir, 'bin', 'libportaudio.dylib');
    if (arch === 'arm' || arch === 'arm64')
        return path.join(dir, 'bin_armhf', 'libportaudio.so.2');
    return path.join(dir, 'bin', 'libportaudio.so.2');
}
const lib = koffi.load(resolveLibPath());
// ─────────────────────────────────────────────────────────────────────────────
// koffi struct definitions  (order and types mirror portaudio.h)
// ─────────────────────────────────────────────────────────────────────────────
exports.PaVersionInfoType = koffi.struct('PaVersionInfo', {
    versionMajor: 'int',
    versionMinor: 'int',
    versionSubMinor: 'int',
    versionControlRevision: 'str',
    versionText: 'str',
});
exports.PaDeviceInfoType = koffi.struct('PaDeviceInfo', {
    structVersion: 'int',
    name: 'str',
    hostApi: 'int',
    maxInputChannels: 'int',
    maxOutputChannels: 'int',
    defaultLowInputLatency: 'double',
    defaultLowOutputLatency: 'double',
    defaultHighInputLatency: 'double',
    defaultHighOutputLatency: 'double',
    defaultSampleRate: 'double',
});
exports.PaHostApiInfoType = koffi.struct('PaHostApiInfo', {
    structVersion: 'int',
    type: 'int',
    name: 'str',
    deviceCount: 'int',
    defaultInputDevice: 'int',
    defaultOutputDevice: 'int',
});
exports.PaStreamParametersType = koffi.struct('PaStreamParameters', {
    device: 'int',
    channelCount: 'int',
    sampleFormat: 'unsigned long',
    suggestedLatency: 'double',
    hostApiSpecificStreamInfo: 'void *',
});
exports.PaStreamInfoType = koffi.struct('PaStreamInfo', {
    structVersion: 'int',
    inputLatency: 'double',
    outputLatency: 'double',
    sampleRate: 'double',
});
// ─────────────────────────────────────────────────────────────────────────────
// PortAudio constants
// ─────────────────────────────────────────────────────────────────────────────
exports.paNoError = 0;
exports.paInputOverflowed = -9981;
exports.paOutputUnderflowed = -9980;
exports.paNoDevice = -1;
exports.paFormatIsSupported = 0;
exports.paNoFlag = 0;
exports.paFramesPerBufferUnspecified = 0;
/** naudiodon sampleFormat code → PortAudio PaSampleFormat flag value */
exports.PA_FORMATS = {
    1: 0x00000001, // paFloat32
    8: 0x00000010, // paInt8
    16: 0x00000008, // paInt16
    24: 0x00000004, // paInt24 (packed)
    32: 0x00000002, // paInt32
};
const PA_HOST_API_TYPES = {
    0: 'InDevelopment',
    1: 'DirectSound',
    2: 'MME',
    3: 'ASIO',
    4: 'SoundManager',
    5: 'CoreAudio',
    7: 'OSS',
    8: 'ALSA',
    9: 'AL',
    10: 'BeOS',
    11: 'WDMKS',
    12: 'JACK',
    13: 'WASAPI',
    14: 'AudioScienceHPI',
};
// ─────────────────────────────────────────────────────────────────────────────
// Synchronous function bindings  (fast: init / enumeration / open / start)
// ─────────────────────────────────────────────────────────────────────────────
exports.Pa_Initialize = lib.func('int Pa_Initialize()');
exports.Pa_Terminate = lib.func('int Pa_Terminate()');
exports.Pa_GetVersionInfo = lib.func('const PaVersionInfo* Pa_GetVersionInfo()');
exports.Pa_GetDeviceCount = lib.func('int Pa_GetDeviceCount()');
exports.Pa_GetDefaultInputDevice = lib.func('int Pa_GetDefaultInputDevice()');
exports.Pa_GetDefaultOutputDevice = lib.func('int Pa_GetDefaultOutputDevice()');
exports.Pa_GetDeviceInfo = lib.func('const PaDeviceInfo* Pa_GetDeviceInfo(int device)');
exports.Pa_GetHostApiCount = lib.func('int Pa_GetHostApiCount()');
exports.Pa_GetDefaultHostApi = lib.func('int Pa_GetDefaultHostApi()');
exports.Pa_GetHostApiInfo = lib.func('const PaHostApiInfo* Pa_GetHostApiInfo(int hostApi)');
exports.Pa_GetErrorText = lib.func('const char* Pa_GetErrorText(int errorCode)');
exports.Pa_IsFormatSupported = lib.func('int Pa_IsFormatSupported(const PaStreamParameters *inputParameters, const PaStreamParameters *outputParameters, double sampleRate)');
// Pa_OpenStream in blocking (null-callback) mode.
// The first argument is PaStream** (an output pointer); koffi writes the result
// into index 0 of a JS array: const ref = [null]; Pa_OpenStream(ref, ...)
exports.Pa_OpenStream = lib.func('int Pa_OpenStream(_Out_ void **stream, const PaStreamParameters *inputParameters, const PaStreamParameters *outputParameters, double sampleRate, unsigned long framesPerBuffer, unsigned long streamFlags, void *streamCallback, void *userData)');
exports.Pa_CloseStream = lib.func('int Pa_CloseStream(void *stream)');
exports.Pa_GetStreamInfo = lib.func('const PaStreamInfo* Pa_GetStreamInfo(void *stream)');
exports.Pa_StartStream = lib.func('int Pa_StartStream(void *stream)');
// ─────────────────────────────────────────────────────────────────────────────
// Async function bindings  (blocking — dispatched to libuv thread pool)
//
// koffi 2.x exposes func.async(...args, callback) for off-thread execution.
// util.promisify(func.async.bind(func)) converts to Promise<number>.
// ─────────────────────────────────────────────────────────────────────────────
const _Pa_StopStream = lib.func('int Pa_StopStream(void *stream)');
const _Pa_AbortStream = lib.func('int Pa_AbortStream(void *stream)');
const _Pa_WriteStream = lib.func('int Pa_WriteStream(void *stream, const void *buffer, unsigned long frames)');
const _Pa_ReadStream = lib.func('int Pa_ReadStream(void *stream, void *buffer, unsigned long frames)');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
exports.Pa_StopStream_async = (0, util_1.promisify)(_Pa_StopStream.async.bind(_Pa_StopStream));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
exports.Pa_AbortStream_async = (0, util_1.promisify)(_Pa_AbortStream.async.bind(_Pa_AbortStream));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
exports.Pa_WriteStream_async = (0, util_1.promisify)(_Pa_WriteStream.async.bind(_Pa_WriteStream));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
exports.Pa_ReadStream_async = (0, util_1.promisify)(_Pa_ReadStream.async.bind(_Pa_ReadStream));
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function checkErr(code, context) {
    if (code !== exports.paNoError)
        throw new Error(`PortAudio ${context}: ${(0, exports.Pa_GetErrorText)(code)}`);
}
function getSampleFormat(fmt) {
    const pf = exports.PA_FORMATS[fmt];
    if (pf === undefined)
        throw new Error(`Invalid sampleFormat: ${fmt}`);
    return pf;
}
function decodeVersionInfo(ptr) {
    return koffi.decode(ptr, exports.PaVersionInfoType);
}
function decodeDeviceInfo(ptr) {
    return koffi.decode(ptr, exports.PaDeviceInfoType);
}
function decodeHostApiInfo(ptr) {
    return koffi.decode(ptr, exports.PaHostApiInfoType);
}
function decodeStreamInfo(ptr) {
    return koffi.decode(ptr, exports.PaStreamInfoType);
}
// ─────────────────────────────────────────────────────────────────────────────
// High-level device / host-API enumeration  (synchronous — no stream open)
// ─────────────────────────────────────────────────────────────────────────────
function getDevices() {
    checkErr((0, exports.Pa_Initialize)(), 'Pa_Initialize');
    try {
        const count = (0, exports.Pa_GetDeviceCount)();
        const devices = [];
        for (let i = 0; i < count; i++) {
            const dev = decodeDeviceInfo((0, exports.Pa_GetDeviceInfo)(i));
            const api = decodeHostApiInfo((0, exports.Pa_GetHostApiInfo)(dev.hostApi));
            devices.push({
                id: i,
                name: dev.name,
                maxInputChannels: dev.maxInputChannels,
                maxOutputChannels: dev.maxOutputChannels,
                defaultSampleRate: dev.defaultSampleRate,
                defaultLowInputLatency: dev.defaultLowInputLatency,
                defaultLowOutputLatency: dev.defaultLowOutputLatency,
                defaultHighInputLatency: dev.defaultHighInputLatency,
                defaultHighOutputLatency: dev.defaultHighOutputLatency,
                hostAPIName: api.name,
            });
        }
        return devices;
    }
    finally {
        (0, exports.Pa_Terminate)();
    }
}
function getHostAPIs() {
    checkErr((0, exports.Pa_Initialize)(), 'Pa_Initialize');
    try {
        const defaultHostAPI = (0, exports.Pa_GetDefaultHostApi)();
        const count = (0, exports.Pa_GetHostApiCount)();
        const HostAPIs = [];
        for (let i = 0; i < count; i++) {
            const info = decodeHostApiInfo((0, exports.Pa_GetHostApiInfo)(i));
            HostAPIs.push({
                id: i,
                name: info.name,
                type: PA_HOST_API_TYPES[info.type] ?? 'Unknown',
                deviceCount: info.deviceCount,
                defaultInput: info.defaultInputDevice,
                defaultOutput: info.defaultOutputDevice,
            });
        }
        return { defaultHostAPI, HostAPIs };
    }
    finally {
        (0, exports.Pa_Terminate)();
    }
}
//# sourceMappingURL=portaudio.js.map