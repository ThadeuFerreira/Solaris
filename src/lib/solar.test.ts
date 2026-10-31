import { describe, expect, it } from 'vitest';
import {
  annualFromDailyMeans,
  beamRatio,
  declination,
  extraterrestrialDaily,
  noonElevation,
  optimalTilt,
  rowShadeGap,
  sunsetHourAngle,
  tiltedIrradiation,
} from './solar';

// Approximate NASA POWER climatology for São Paulo (kWh/m²/day).
const SAO_PAULO_GHI = [5.6, 5.7, 5.0, 4.3, 3.6, 3.4, 3.6, 4.4, 4.6, 5.1, 5.5, 5.7];

describe('solar geometry', () => {
  it('computes declination at the solstices and equinox', () => {
    expect(declination(172)).toBeCloseTo(23.45, 1);
    expect(declination(355)).toBeCloseTo(-23.45, 1);
    expect(Math.abs(declination(81))).toBeLessThan(0.5);
  });

  it('has 12 h days at the equator', () => {
    expect(sunsetHourAngle(0, 23.45)).toBeCloseTo(90, 5);
  });

  it('matches the textbook extraterrestrial irradiation', () => {
    // Duffie & Beckman example 1.10.1: 43° N on April 15 → 33.8 MJ/m².
    expect(extraterrestrialDaily(43, 105) * 3.6).toBeCloseTo(33.8, 0);
  });

  it('puts the noon sun overhead at the Tropic of Capricorn in December', () => {
    expect(noonElevation(-23.44, 355)).toBeGreaterThan(89.5);
  });
});

describe('tilted irradiation', () => {
  it('equals the horizontal value at zero tilt', () => {
    const tilted = tiltedIrradiation(-23.55, SAO_PAULO_GHI, { tiltDeg: 0, azimuthDeg: 0 });
    tilted.forEach((v, i) => expect(v).toBeCloseTo(SAO_PAULO_GHI[i], 6));
  });

  it('favours north-facing panels in the southern hemisphere', () => {
    expect(beamRatio(-23.55, 172, 25, 0)).toBeGreaterThan(1);
    expect(beamRatio(-23.55, 172, 25, 180)).toBeLessThan(1);
  });

  it('finds an optimal tilt close to the latitude for São Paulo', () => {
    const tilt = optimalTilt(-23.55, SAO_PAULO_GHI, 0);
    expect(tilt).toBeGreaterThanOrEqual(15);
    expect(tilt).toBeLessThanOrEqual(28);
    const flat = annualFromDailyMeans(SAO_PAULO_GHI);
    const best = annualFromDailyMeans(tiltedIrradiation(-23.55, SAO_PAULO_GHI, { tiltDeg: tilt, azimuthDeg: 0 }));
    expect(best / flat).toBeGreaterThan(1.03);
    expect(best / flat).toBeLessThan(1.15);
  });

  it('is symmetric for east and west orientations', () => {
    const east = annualFromDailyMeans(tiltedIrradiation(-15, SAO_PAULO_GHI, { tiltDeg: 20, azimuthDeg: 90 }));
    const west = annualFromDailyMeans(tiltedIrradiation(-15, SAO_PAULO_GHI, { tiltDeg: 20, azimuthDeg: 270 }));
    expect(east).toBeCloseTo(west, 6);
  });
});

describe('row spacing', () => {
  it('needs no gap for flat panels', () => {
    expect(rowShadeGap(-23.55, 2.278, 0, 0)).toBe(0);
  });

  it('needs a larger gap further from the equator', () => {
    const recife = rowShadeGap(-8, 2.278, 15, 0);
    const portoAlegre = rowShadeGap(-30, 2.278, 15, 0);
    expect(recife).toBeGreaterThan(0);
    expect(portoAlegre).toBeGreaterThan(recife);
    // 15° tilt in Porto Alegre: height ≈ 0.59 m, low winter sun → ~1–2 m.
    expect(portoAlegre).toBeGreaterThan(0.8);
    expect(portoAlegre).toBeLessThan(2.5);
  });
});
