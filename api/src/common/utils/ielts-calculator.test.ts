import { describe, expect, it } from "vitest";
import {
  calculateOverallBand,
  calculateWritingBand,
  roundIeltsBand,
} from "./ielts-calculator.js";

describe("roundIeltsBand", () => {
  it("rounds down when the decimal is below 0.25", () => {
    expect(roundIeltsBand(6.125)).toBe(6.0);
    expect(roundIeltsBand(6.0)).toBe(6.0);
  });

  it("rounds to .5 when the decimal is between 0.25 and 0.75", () => {
    expect(roundIeltsBand(6.25)).toBe(6.5);
    expect(roundIeltsBand(6.625)).toBe(6.5);
  });

  it("rounds up when the decimal is 0.75 or above", () => {
    expect(roundIeltsBand(6.75)).toBe(7.0);
    expect(roundIeltsBand(6.9)).toBe(7.0);
  });
});

describe("calculateWritingBand", () => {
  it("weights Task 2 twice as much as Task 1", () => {
    expect(calculateWritingBand(6.0, 7.0)).toBe(roundIeltsBand((6 + 7 * 2) / 3));
    expect(calculateWritingBand(6.5, 6.5)).toBe(6.5);
  });
});

describe("calculateOverallBand", () => {
  it("averages the provided skill bands and rounds them", () => {
    expect(calculateOverallBand({ listening: 6.5, reading: 6.0, writing: 5.5 })).toBe(6.0);
  });

  it("ignores missing skills", () => {
    expect(calculateOverallBand({ listening: 7.0, reading: 7.0 })).toBe(7.0);
  });

  it("returns 0 when no scores are provided", () => {
    expect(calculateOverallBand({})).toBe(0);
  });
});
