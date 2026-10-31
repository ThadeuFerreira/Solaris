// Solar geometry and irradiance models (Duffie & Beckman, "Solar Engineering
// of Thermal Processes"). Everything here depends only on latitude, the day of
// the year and — for tilted surfaces — the measured horizontal irradiation.

const SOLAR_CONSTANT = 1367; // W/m²
const DEG = Math.PI / 180;

export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Day of the year whose extraterrestrial irradiation best represents the
// monthly mean (Klein, 1977).
export const REPRESENTATIVE_DAYS = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344];

export const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/** Solar declination in degrees (Cooper, 1969). */
export function declination(dayOfYear: number): number {
  return 23.45 * Math.sin((360 * (284 + dayOfYear) / 365) * DEG);
}

/** Sunset hour angle in degrees. Clamped for polar day / night. */
export function sunsetHourAngle(latDeg: number, declDeg: number): number {
  const x = -Math.tan(latDeg * DEG) * Math.tan(declDeg * DEG);
  return Math.acos(Math.min(1, Math.max(-1, x))) / DEG;
}

export function daylightHours(latDeg: number, dayOfYear: number): number {
  return (2 / 15) * sunsetHourAngle(latDeg, declination(dayOfYear));
}

/** Solar elevation at solar noon, in degrees. */
export function noonElevation(latDeg: number, dayOfYear: number): number {
  return 90 - Math.abs(latDeg - declination(dayOfYear));
}

/** Daily extraterrestrial irradiation on a horizontal plane, kWh/m²/day. */
export function extraterrestrialDaily(latDeg: number, dayOfYear: number): number {
  const phi = latDeg * DEG;
  const delta = declination(dayOfYear) * DEG;
  const ws = sunsetHourAngle(latDeg, declination(dayOfYear)) * DEG;
  const e0 = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
  const wh =
    (24 / Math.PI) *
    SOLAR_CONSTANT *
    e0 *
    (Math.cos(phi) * Math.cos(delta) * Math.sin(ws) + ws * Math.sin(phi) * Math.sin(delta));
  return Math.max(0, wh) / 1000;
}

export function monthlyExtraterrestrial(latDeg: number): number[] {
  return REPRESENTATIVE_DAYS.map((n) => extraterrestrialDaily(latDeg, n));
}

/**
 * Typical clearness index (GHI / extraterrestrial) used when no measured data
 * is available. Brazilian sites range roughly 0.45–0.60 on an annual basis.
 */
export const TYPICAL_CLEARNESS_INDEX = 0.52;

/** Latitude-only estimate of monthly mean GHI, kWh/m²/day. */
export function estimateGhiFromLatitude(latDeg: number): number[] {
  return monthlyExtraterrestrial(latDeg).map((h0) => h0 * TYPICAL_CLEARNESS_INDEX);
}

/** Monthly-average diffuse fraction Hd/H (Erbs et al., 1982). */
export function diffuseFraction(kt: number, sunsetAngleDeg: number): number {
  const k = Math.min(0.8, Math.max(0.3, kt));
  const f =
    sunsetAngleDeg <= 81.4
      ? 1.391 - 3.56 * k + 4.189 * k ** 2 - 2.137 * k ** 3
      : 1.311 - 3.022 * k + 3.427 * k ** 2 - 1.821 * k ** 3;
  return Math.min(1, Math.max(0, f));
}

/**
 * Converts a panel compass azimuth (0 = North, 90 = East, 180 = South, 270 =
 * West) into the Duffie & Beckman convention (0 = facing the equator in the
 * north hemisphere i.e. South, East negative, West positive).
 */
function surfaceAzimuthDB(compassDeg: number): number {
  return ((compassDeg - 180 + 540) % 360) - 180;
}

/**
 * Ratio of daily beam irradiation on the tilted plane to the horizontal one,
 * integrated numerically over the day so it works for any azimuth and both
 * hemispheres.
 */
export function beamRatio(latDeg: number, dayOfYear: number, tiltDeg: number, azimuthCompassDeg: number): number {
  const phi = latDeg * DEG;
  const delta = declination(dayOfYear) * DEG;
  const beta = tiltDeg * DEG;
  const gamma = surfaceAzimuthDB(azimuthCompassDeg) * DEG;
  const ws = sunsetHourAngle(latDeg, declination(dayOfYear));
  if (ws <= 0) return 0;

  const sd = Math.sin(delta);
  const cd = Math.cos(delta);
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const sb = Math.sin(beta);
  const cb = Math.cos(beta);
  const sg = Math.sin(gamma);
  const cg = Math.cos(gamma);

  let tilted = 0;
  let horizontal = 0;
  // Midpoint rule over a grid symmetric around solar noon.
  const steps = 240;
  const step = (2 * ws) / steps;
  for (let i = 0; i < steps; i++) {
    const om = (-ws + (i + 0.5) * step) * DEG;
    const cw = Math.cos(om);
    const sw = Math.sin(om);
    const cosZenith = cp * cd * cw + sp * sd;
    if (cosZenith <= 0) continue;
    const cosIncidence =
      sd * sp * cb - sd * cp * sb * cg + cd * cp * cb * cw + cd * sp * sb * cg * cw + cd * sb * sg * sw;
    horizontal += cosZenith;
    tilted += Math.max(0, cosIncidence);
  }
  return horizontal > 0 ? tilted / horizontal : 0;
}

export interface TiltedOptions {
  tiltDeg: number;
  azimuthDeg: number; // compass, 0 = North
  albedo?: number;
}

/**
 * Monthly mean daily irradiation on a tilted surface (kWh/m²/day) from the
 * monthly mean horizontal irradiation, using the isotropic sky model
 * (Liu & Jordan) with the Erbs diffuse split.
 */
export function tiltedIrradiation(latDeg: number, ghiMonthly: number[], opts: TiltedOptions): number[] {
  const albedo = opts.albedo ?? 0.2;
  const beta = opts.tiltDeg * DEG;
  return ghiMonthly.map((ghi, m) => {
    const n = REPRESENTATIVE_DAYS[m];
    const h0 = extraterrestrialDaily(latDeg, n);
    if (ghi <= 0 || h0 <= 0) return 0;
    const ws = sunsetHourAngle(latDeg, declination(n));
    const hd = ghi * diffuseFraction(ghi / h0, ws);
    const hb = ghi - hd;
    const rb = beamRatio(latDeg, n, opts.tiltDeg, opts.azimuthDeg);
    return hb * rb + (hd * (1 + Math.cos(beta))) / 2 + (ghi * albedo * (1 - Math.cos(beta))) / 2;
  });
}

/** Annual irradiation (kWh/m²/year) for a monthly daily-mean series. */
export function annualFromDailyMeans(dailyMeans: number[]): number {
  return dailyMeans.reduce((sum, v, m) => sum + v * MONTH_DAYS[m], 0);
}

/** Tilt (whole degrees, 0–60) that maximises annual irradiation for an azimuth. */
export function optimalTilt(latDeg: number, ghiMonthly: number[], azimuthDeg: number): number {
  let best = 0;
  let bestValue = -Infinity;
  for (let tilt = 0; tilt <= 60; tilt++) {
    const value = annualFromDailyMeans(tiltedIrradiation(latDeg, ghiMonthly, { tiltDeg: tilt, azimuthDeg }));
    if (value > bestValue) {
      bestValue = value;
      best = tilt;
    }
  }
  return best;
}

/** Azimuth that faces the equator: North in the southern hemisphere. */
export function equatorFacingAzimuth(latDeg: number): number {
  return latDeg < 0 ? 0 : 180;
}

/** Sun direction as an East/North/Up unit vector. */
export function sunVector(latDeg: number, declDeg: number, hourAngleDeg: number): { e: number; n: number; u: number } {
  const phi = latDeg * DEG;
  const delta = declDeg * DEG;
  const om = hourAngleDeg * DEG;
  return {
    e: -Math.cos(delta) * Math.sin(om),
    n: Math.sin(delta) * Math.cos(phi) - Math.cos(delta) * Math.sin(phi) * Math.cos(om),
    u: Math.cos(phi) * Math.cos(delta) * Math.cos(om) + Math.sin(phi) * Math.sin(delta),
  };
}

/**
 * Clear distance needed between rows of tilted panels so that a row does not
 * shade the one behind it between 9h and 15h (solar time) on the winter
 * solstice. Returns metres along the facing direction.
 */
export function rowShadeGap(latDeg: number, panelSlopeLengthM: number, tiltDeg: number, azimuthDeg: number): number {
  const height = panelSlopeLengthM * Math.sin(tiltDeg * DEG);
  if (height <= 0) return 0;
  const winterSolstice = latDeg < 0 ? 172 : 355;
  const decl = declination(winterSolstice);
  const facing = { e: Math.sin(azimuthDeg * DEG), n: Math.cos(azimuthDeg * DEG) };
  let gap = 0;
  for (let w = -45; w <= 45; w += 5) {
    const sun = sunVector(latDeg, decl, w);
    // A sun barely above the horizon would demand a gap of hundreds of metres;
    // below ~5° the irradiance is negligible anyway.
    if (sun.u < Math.sin(5 * DEG)) continue;
    const behind = (height * (sun.e * facing.e + sun.n * facing.n)) / sun.u;
    gap = Math.max(gap, behind);
  }
  return gap;
}
