// The footer temperature: off until a place is set, in the scale asked for,
// and one refresh at a time (maintenance review 2026-10-15, D5 + W6).
//
// `coords: [0, 0]` is the shipped default (engine backfill and the example
// config alike), and the weather fetch used to run on it anyway: a new fork's
// footer reported the sea at 0°N 0°E, in °F, wherever the fork was.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { weatherEnabled, temperatureUnit } from '../src/edge/weather.js';
import { BACKFILL } from '../src/shared/config.js';

describe('weatherEnabled: is there a place to report on?', () => {
  it('is off at the shipped [0, 0]', () => {
    expect(weatherEnabled({ coords: [0, 0] })).toBe(false);
    expect(weatherEnabled(BACKFILL.location)).toBe(false);
  });

  it('is off for anything that is not two finite numbers', () => {
    for (const coords of [undefined, null, [], [1], [1, 2, 3], ['a', 'b'], [NaN, 2], [1, Infinity]]) {
      expect(weatherEnabled({ coords })).toBe(false);
    }
    expect(weatherEnabled(null)).toBe(false);
    expect(weatherEnabled({})).toBe(false);
  });

  it('is on for a real place, including one on a meridian or the equator', () => {
    expect(weatherEnabled({ coords: [37.8, -122.27] })).toBe(true);
    expect(weatherEnabled({ coords: [51.48, 0] })).toBe(true);   // Greenwich
    expect(weatherEnabled({ coords: [0, -78.5] })).toBe(true);   // Quito-ish
  });
});

describe('temperatureUnit', () => {
  it('backfills fahrenheit, so no existing site changes', () => {
    expect(BACKFILL.location.units).toBe('fahrenheit');
    expect(temperatureUnit({})).toBe('fahrenheit');
    expect(temperatureUnit({ units: 'kelvin' })).toBe('fahrenheit');
  });
  it('honours celsius', () => {
    expect(temperatureUnit({ units: 'celsius' })).toBe('celsius');
  });
});

describe('the refresh', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); delete globalThis.caches; });

  async function weatherWith(location) {
    vi.resetModules();
    vi.doMock('../site.config.js', async (importOriginal) => {
      const actual = await importOriginal();
      return { default: Object.freeze({ ...actual.default, location }) };
    });
    globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
    return import('../src/edge/weather.js');
  }

  it('makes no call at [0, 0]', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const wx = await weatherWith({ name: 'X', region: '', coords: [0, 0] });
    await wx.refreshLocalTemp('https://example.com');
    expect(await wx.readCachedTemp('https://example.com')).toBe(null);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks in the configured scale, and only once while one is running', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await gate;
      return new Response(JSON.stringify({ current_weather: { temperature: 12.4 } }));
    });
    const wx = await weatherWith({ name: 'X', region: '', coords: [51.5, -0.12], units: 'celsius' });
    const a = wx.refreshLocalTemp('https://example.com');
    const b = wx.refreshLocalTemp('https://example.com');
    release();
    await Promise.all([a, b]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('temperature_unit=celsius');
  });
});
