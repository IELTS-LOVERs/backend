import { describe, expect, it } from "vitest";
import { evaluateSuspicious } from "./anti-cheat.service.js";

const thresholds = { tabSwitch: 5, fullscreenExit: 2, paste: 3 };

describe("evaluateSuspicious", () => {
  it("returns false when every counter is at zero", () => {
    expect(
      evaluateSuspicious({ tabSwitchOrBlur: 0, fullscreenExit: 0, paste: 0 }, thresholds)
    ).toBe(false);
  });

  it("stays below the tab switch threshold", () => {
    expect(
      evaluateSuspicious({ tabSwitchOrBlur: 4, fullscreenExit: 1, paste: 2 }, thresholds)
    ).toBe(false);
  });

  it("flags at the exact tab switch threshold", () => {
    expect(
      evaluateSuspicious({ tabSwitchOrBlur: 5, fullscreenExit: 0, paste: 0 }, thresholds)
    ).toBe(true);
  });

  it("flags above the fullscreen exit threshold", () => {
    expect(
      evaluateSuspicious({ tabSwitchOrBlur: 0, fullscreenExit: 3, paste: 0 }, thresholds)
    ).toBe(true);
  });

  it("flags at the exact paste threshold", () => {
    expect(
      evaluateSuspicious({ tabSwitchOrBlur: 0, fullscreenExit: 1, paste: 3 }, thresholds)
    ).toBe(true);
  });

  it("respects custom thresholds", () => {
    const custom = { tabSwitch: 10, fullscreenExit: 5, paste: 8 };

    expect(
      evaluateSuspicious({ tabSwitchOrBlur: 9, fullscreenExit: 4, paste: 7 }, custom)
    ).toBe(false);
    expect(
      evaluateSuspicious({ tabSwitchOrBlur: 10, fullscreenExit: 0, paste: 0 }, custom)
    ).toBe(true);
  });
});
