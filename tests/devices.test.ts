/**
 * Hardware-free unit tests for naudiodon2.
 *
 * Tests that verify the full stack from TypeScript → koffi → PortAudio DLL
 * without requiring any audio to be played or recorded.
 *
 * Covers:
 *  - Sample format constant values
 *  - getDevices() — shape, types, and required fields
 *  - getHostAPIs() — shape, types, and required fields
 *  - AudioIO() — option validation (bad options throw before touching hardware)
 *  - AudioIO() — stream type selection (Readable/Writable/Duplex)
 *  - AudioIO() — open + immediate quit lifecycle (opens device then stops cleanly)
 */

import { describe, it, expect } from 'vitest';
import {
  SampleFormatFloat32, SampleFormat8Bit, SampleFormat16Bit,
  SampleFormat24Bit, SampleFormat32Bit,
  getDevices, getHostAPIs, AudioIO,
  type DeviceInfo, type HostApiInfo,
} from '../src/index';

// ─────────────────────────────────────────────────────────────────────────────
// Sample format constants
// ─────────────────────────────────────────────────────────────────────────────

describe('Sample format constants', () => {
  it('SampleFormatFloat32 === 1',  () => expect(SampleFormatFloat32).toBe(1));
  it('SampleFormat8Bit   === 8',   () => expect(SampleFormat8Bit).toBe(8));
  it('SampleFormat16Bit  === 16',  () => expect(SampleFormat16Bit).toBe(16));
  it('SampleFormat24Bit  === 24',  () => expect(SampleFormat24Bit).toBe(24));
  it('SampleFormat32Bit  === 32',  () => expect(SampleFormat32Bit).toBe(32));
});

// ─────────────────────────────────────────────────────────────────────────────
// getDevices()
// ─────────────────────────────────────────────────────────────────────────────

describe('getDevices()', () => {
  it('returns an array', () => {
    const devices = getDevices();
    expect(Array.isArray(devices)).toBe(true);
  });

  it('returns at least one device', () => {
    const devices = getDevices();
    expect(devices.length).toBeGreaterThan(0);
  });

  it('every device has the expected shape', () => {
    const devices = getDevices();
    for (const d of devices) {
      const dev = d as DeviceInfo;
      expect(typeof dev.id).toBe('number');
      expect(typeof dev.name).toBe('string');
      expect(dev.name.length).toBeGreaterThan(0);
      expect(typeof dev.maxInputChannels).toBe('number');
      expect(typeof dev.maxOutputChannels).toBe('number');
      expect(typeof dev.defaultSampleRate).toBe('number');
      expect(dev.defaultSampleRate).toBeGreaterThan(0);
      expect(typeof dev.defaultLowInputLatency).toBe('number');
      expect(typeof dev.defaultLowOutputLatency).toBe('number');
      expect(typeof dev.defaultHighInputLatency).toBe('number');
      expect(typeof dev.defaultHighOutputLatency).toBe('number');
      expect(typeof dev.hostAPIName).toBe('string');
      expect(dev.hostAPIName.length).toBeGreaterThan(0);
    }
  });

  it('device ids are sequential from 0', () => {
    const devices = getDevices();
    devices.forEach((d, i) => expect(d.id).toBe(i));
  });

  it('can be called multiple times without error', () => {
    expect(() => { getDevices(); getDevices(); }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getHostAPIs()
// ─────────────────────────────────────────────────────────────────────────────

describe('getHostAPIs()', () => {
  it('returns an object with defaultHostAPI and HostAPIs', () => {
    const result = getHostAPIs();
    expect(typeof result.defaultHostAPI).toBe('number');
    expect(Array.isArray(result.HostAPIs)).toBe(true);
  });

  it('returns at least one host API', () => {
    const { HostAPIs } = getHostAPIs();
    expect(HostAPIs.length).toBeGreaterThan(0);
  });

  it('defaultHostAPI index is within range', () => {
    const { defaultHostAPI, HostAPIs } = getHostAPIs();
    expect(defaultHostAPI).toBeGreaterThanOrEqual(0);
    expect(defaultHostAPI).toBeLessThan(HostAPIs.length);
  });

  it('every host API has the expected shape', () => {
    const { HostAPIs } = getHostAPIs();
    for (const h of HostAPIs) {
      const api = h as HostApiInfo;
      expect(typeof api.id).toBe('number');
      expect(typeof api.name).toBe('string');
      expect(api.name.length).toBeGreaterThan(0);
      expect(typeof api.type).toBe('string');
      expect(typeof api.deviceCount).toBe('number');
      expect(typeof api.defaultInput).toBe('number');
      expect(typeof api.defaultOutput).toBe('number');
    }
  });

  it('host API type values are valid strings', () => {
    const valid = new Set([
      'InDevelopment', 'DirectSound', 'MME', 'ASIO', 'SoundManager',
      'CoreAudio', 'OSS', 'ALSA', 'AL', 'BeOS', 'WDMKS', 'JACK',
      'WASAPI', 'AudioScienceHPI', 'Unknown',
    ]);
    const { HostAPIs } = getHostAPIs();
    for (const h of HostAPIs)
      expect(valid.has(h.type)).toBe(true);
  });

  it('can be called multiple times without error', () => {
    expect(() => { getHostAPIs(); getHostAPIs(); }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AudioIO() — option validation
// ─────────────────────────────────────────────────────────────────────────────

describe('AudioIO() option validation', () => {
  it('throws if neither inOptions nor outOptions provided', () => {
    expect(() => AudioIO({} as never)).toThrow('inOptions and/or outOptions must be provided');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AudioIO() — stream type selection
// ─────────────────────────────────────────────────────────────────────────────

describe('AudioIO() stream type', () => {
  // Each test opens a real device; quit() is called immediately.

  it('creates a Writable for outOptions only', async () => {
    const ao = AudioIO({ outOptions: { channelCount: 2, sampleFormat: SampleFormat16Bit, sampleRate: 44100 } });
    expect(ao.writable).toBe(true);
    await ao.quit();
  });

  it('creates a Readable for inOptions only', async () => {
    const ai = AudioIO({ inOptions: { channelCount: 2, sampleFormat: SampleFormat16Bit, sampleRate: 44100 } });
    expect(ai.readable).toBe(true);
    await ai.quit();
  });

  it('creates a Duplex for both options', async () => {
    const ad = AudioIO({
      inOptions:  { channelCount: 2, sampleFormat: SampleFormat16Bit, sampleRate: 44100 },
      outOptions: { channelCount: 2, sampleFormat: SampleFormat16Bit, sampleRate: 44100 },
    });
    expect(ad.readable).toBe(true);
    expect(ad.writable).toBe(true);
    await ad.quit();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AudioIO() — start + abort lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('AudioIO() lifecycle', () => {
  it('start() and abort() complete without error', async () => {
    const ao = AudioIO({ outOptions: { channelCount: 2, sampleFormat: SampleFormat16Bit, sampleRate: 44100 } });
    ao.start();
    await ao.abort();
  });

  it('quit() is idempotent (safe to call twice)', async () => {
    const ao = AudioIO({ outOptions: { channelCount: 2, sampleFormat: SampleFormat16Bit, sampleRate: 44100 } });
    await ao.quit();
    await expect(ao.quit()).resolves.toBeUndefined();
  });

  it('emits finished after end() on output stream', async () => {
    await new Promise<void>((resolve, reject) => {
      const ao = AudioIO({ outOptions: { channelCount: 1, sampleFormat: SampleFormat8Bit, sampleRate: 44100 } });
      ao.on('finished', resolve);
      ao.on('error', reject);
      ao.start();
      // Write a tiny silent buffer then end the stream
      const silence = Buffer.alloc(4096, 0);
      ao.write(silence);
      ao.end();
    });
  }, 10_000); // up to 10 s for the DAC to drain
});
