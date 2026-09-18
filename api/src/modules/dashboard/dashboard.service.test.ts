import { describe, expect, it } from "vitest";
import { calculateAverageBand } from "./dashboard.service.js";

describe("calculateAverageBand", () => {
  it("returns null for empty array", () => {
    expect(calculateAverageBand([])).toBeNull();
  });

  it("returns null when all entries are null or undefined", () => {
    expect(calculateAverageBand([null, undefined, null])).toBeNull();
  });

  it("calculates accurate average for valid scores", () => {
    expect(calculateAverageBand([6.0, 7.0, 8.0])).toBe(7.0);
  });

  it("rounds to one decimal place correctly", () => {
    // (6.0 + 6.5 + 7.0) / 3 = 19.5 / 3 = 6.5
    expect(calculateAverageBand([6.0, 6.5, 7.0])).toBe(6.5);

    // (6.0 + 6.0 + 7.0) / 3 = 19 / 3 = 6.333333333333333 -> 6.3
    expect(calculateAverageBand([6.0, 6.0, 7.0])).toBe(6.3);

    // (6.5 + 7.0 + 7.0) / 3 = 20.5 / 3 = 6.833333333333333 -> 6.8
    expect(calculateAverageBand([6.5, 7.0, 7.0])).toBe(6.8);
  });

  it("filters out null and undefined values before computing average", () => {
    expect(calculateAverageBand([null, 7.0, undefined, 8.0])).toBe(7.5);
  });
});
