import { describe, expect, it } from "vitest";
import {
  defaultThresholdsForSkill,
  resolveBandScore,
  validateBandConversion,
} from "./band-conversion.js";
import type { IBandConversion } from "../../modules/exams/exam.model.js";

const custom: IBandConversion = {
  mode: "custom",
  readingType: "academic",
  listeningThresholds: [
    { minRaw: 0, band: 2.0 },
    { minRaw: 30, band: 7.0 },
    { minRaw: 35, band: 8.0 },
    { minRaw: 39, band: 9.0 },
  ],
  readingThresholds: [
    { minRaw: 0, band: 2.0 },
    { minRaw: 28, band: 6.5 },
    { minRaw: 34, band: 7.5 },
  ],
};

describe("resolveBandScore", () => {
  it("uses the built-in listening table in auto mode", () => {
    expect(resolveBandScore(30, "listening", undefined)).toBe(7.0);
    expect(resolveBandScore(39, "listening", undefined)).toBe(9.0);
  });

  it("supports academic vs general reading in auto mode", () => {
    expect(
      resolveBandScore(30, "reading", {
        mode: "auto",
        readingType: "academic",
      })
    ).toBe(7.0);
    expect(
      resolveBandScore(30, "reading", {
        mode: "auto",
        readingType: "general",
      })
    ).toBe(6.5);
  });

  it("uses custom thresholds", () => {
    expect(resolveBandScore(29, "listening", custom)).toBe(2.0);
    expect(resolveBandScore(30, "listening", custom)).toBe(7.0);
    expect(resolveBandScore(38, "listening", custom)).toBe(8.0);
    expect(resolveBandScore(40, "listening", custom)).toBe(9.0);
    expect(resolveBandScore(30, "reading", custom)).toBe(6.5);
  });

  it("falls back to the built-in table when custom thresholds are missing", () => {
    expect(
      resolveBandScore(30, "reading", {
        mode: "custom",
        readingType: "academic",
      })
    ).toBe(7.0);
  });
});

describe("validateBandConversion", () => {
  it("accepts a valid custom table", () => {
    expect(validateBandConversion(custom)).toEqual([]);
  });

  it("rejects missing raw 0, duplicate thresholds, and non-monotonic bands", () => {
    const issues = validateBandConversion({
      mode: "custom",
      readingType: "academic",
      listeningThresholds: [
        { minRaw: 10, band: 8.0 },
        { minRaw: 10, band: 7.0 },
      ],
      readingThresholds: [
        { minRaw: 0, band: 5.0 },
        { minRaw: 20, band: 4.0 },
      ],
    });
    expect(issues.join(" ")).toContain("minRaw = 0");
    expect(issues.join(" ")).toContain("bị trùng");
    expect(issues.join(" ")).toContain("band phải tăng dần");
  });

  it("generates compact defaults covering 0–40", () => {
    const listening = defaultThresholdsForSkill("listening");
    expect(listening[0]).toEqual({ minRaw: 0, band: 2.0 });
    expect(listening.at(-1)).toEqual({ minRaw: 39, band: 9.0 });
  });
});
