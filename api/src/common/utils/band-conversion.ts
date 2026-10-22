import { calculateBandScore } from "../../config/constants.js";
import {
  DEFAULT_BAND_CONVERSION,
  type BandConversionMode,
  type IBandConversion,
  type IBandThreshold,
  type ReadingTrainingType,
} from "../../modules/exams/exam.model.js";

const BAND_STEP = 0.5;

export function normalizeBandConversion(
  input?: Partial<IBandConversion> | null
): IBandConversion {
  if (!input) return { ...DEFAULT_BAND_CONVERSION };
  return {
    mode: input.mode === "custom" ? "custom" : "auto",
    readingType: input.readingType === "general" ? "general" : "academic",
    listeningThresholds: input.listeningThresholds?.map((item) => ({
      minRaw: item.minRaw,
      band: item.band,
    })),
    readingThresholds: input.readingThresholds?.map((item) => ({
      minRaw: item.minRaw,
      band: item.band,
    })),
  };
}

export function validateBandThresholds(
  thresholds: IBandThreshold[] | undefined,
  label: string
): string[] {
  if (!thresholds || thresholds.length === 0) {
    return [`${label}: cần ít nhất một mốc quy đổi.`];
  }

  const issues: string[] = [];
  const seenRaw = new Set<number>();

  for (const item of thresholds) {
    if (!Number.isInteger(item.minRaw) || item.minRaw < 0 || item.minRaw > 40) {
      issues.push(`${label}: minRaw phải là số nguyên từ 0 đến 40.`);
    }
    if (
      typeof item.band !== "number" ||
      !Number.isFinite(item.band) ||
      item.band < 0 ||
      item.band > 9 ||
      Math.round(item.band / BAND_STEP) * BAND_STEP !== item.band
    ) {
      issues.push(`${label}: band phải nằm trong 0–9 và theo bước 0.5.`);
    }
    if (seenRaw.has(item.minRaw)) {
      issues.push(`${label}: minRaw ${item.minRaw} bị trùng.`);
    }
    seenRaw.add(item.minRaw);
  }

  if (!seenRaw.has(0)) {
    issues.push(`${label}: phải có mốc minRaw = 0.`);
  }

  const sorted = [...thresholds].sort((a, b) => a.minRaw - b.minRaw);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].band < sorted[i - 1].band) {
      issues.push(`${label}: band phải tăng dần khi minRaw tăng.`);
      break;
    }
  }

  return issues;
}

export function validateBandConversion(config: IBandConversion): string[] {
  if (config.mode === "auto") return [];
  return [
    ...validateBandThresholds(config.listeningThresholds, "Listening"),
    ...validateBandThresholds(config.readingThresholds, "Reading"),
  ];
}

export function resolveBandScore(
  rawScore: number,
  skill: "listening" | "reading",
  config?: IBandConversion | null
): number {
  const normalized = normalizeBandConversion(config);
  const raw = Math.max(0, Math.min(40, Math.floor(Number.isFinite(rawScore) ? rawScore : 0)));

  if (normalized.mode !== "custom") {
    return calculateBandScore(raw, skill, normalized.readingType);
  }

  const thresholds =
    skill === "listening"
      ? normalized.listeningThresholds
      : normalized.readingThresholds;

  if (!thresholds || thresholds.length === 0) {
    return calculateBandScore(raw, skill, normalized.readingType);
  }

  const sorted = [...thresholds].sort((a, b) => b.minRaw - a.minRaw);
  const matched = sorted.find((item) => raw >= item.minRaw);
  return matched?.band ?? 0;
}

/** Create custom thresholds from a 0–40 raw-to-band map (used by backfill/tests). */
export function thresholdsFromRawMap(
  map: Record<number, number>
): IBandThreshold[] {
  const entries = Object.entries(map)
    .map(([raw, band]) => ({ minRaw: Number(raw), band }))
    .sort((a, b) => a.minRaw - b.minRaw);

  const thresholds: IBandThreshold[] = [];
  let previousBand: number | undefined;

  for (const entry of entries) {
    if (previousBand === undefined || entry.band !== previousBand) {
      thresholds.push(entry);
      previousBand = entry.band;
    }
  }

  if (thresholds[0]?.minRaw !== 0) {
    thresholds.unshift({ minRaw: 0, band: thresholds[0]?.band ?? 2 });
  }

  return thresholds;
}

/** Built-in IELTS table as compact custom thresholds (for the editor preview). */
export function defaultThresholdsForSkill(
  skill: "listening" | "reading",
  readingType: ReadingTrainingType = "academic"
): IBandThreshold[] {
  const thresholds: IBandThreshold[] = [];
  let previousBand: number | undefined;

  for (let raw = 0; raw <= 40; raw += 1) {
    const band = calculateBandScore(raw, skill, readingType);
    if (band !== previousBand) {
      thresholds.push({ minRaw: raw, band });
      previousBand = band;
    }
  }

  return thresholds;
}

export type { BandConversionMode, ReadingTrainingType };
