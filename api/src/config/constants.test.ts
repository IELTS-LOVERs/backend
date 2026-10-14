import { describe, expect, it } from "vitest";
import { calculateBandScore } from "./constants.js";

describe("calculateBandScore", () => {
  it("returns the lowest band (2.0) for 0-3 correct", () => {
    expect(calculateBandScore(0, "listening")).toBe(2.0);
    expect(calculateBandScore(3, "listening")).toBe(2.0);
  });

  it("looks up whole numbers in the table", () => {
    expect(calculateBandScore(4, "listening")).toBe(2.5);
    expect(calculateBandScore(6, "listening")).toBe(3.0);
    expect(calculateBandScore(40, "listening")).toBe(9.0);
  });

  it("floors fractional scores to the lower mark (FIX-08/M-01)", () => {
    // Previously 6.5 produced table[6.5] === undefined → wrong 2.5 fallback.
    expect(calculateBandScore(6.5, "listening")).toBe(3.0);
    expect(calculateBandScore(6.9, "reading")).toBe(3.0);
    expect(calculateBandScore(39.9, "listening")).toBe(9.0);
  });

  it("clamps scores above 40", () => {
    expect(calculateBandScore(41, "listening")).toBe(9.0);
    expect(calculateBandScore(999, "reading")).toBe(9.0);
  });

  it("treats NaN / negative / non-finite as 0", () => {
    expect(calculateBandScore(Number.NaN, "listening")).toBe(2.0);
    expect(calculateBandScore(-5, "listening")).toBe(2.0);
    // Non-finite (Infinity) is not a valid score → treated as 0.
    expect(calculateBandScore(Number.POSITIVE_INFINITY, "reading")).toBe(2.0);
  });

  it("uses the general-training reading table when requested", () => {
    // Reading general: 30 -> 6.5 (academic 30 -> 7.0).
    expect(calculateBandScore(30, "reading", "general")).toBe(6.5);
    expect(calculateBandScore(30, "reading", "academic")).toBe(7.0);
  });
});
