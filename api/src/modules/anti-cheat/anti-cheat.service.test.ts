import { describe, expect, it } from "vitest";
import { evaluateSuspicious, summarizeEvents } from "./anti-cheat.service.js";

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

describe("summarizeEvents", () => {
  it("correctly counts and aggregates event categories", () => {
    const events = [
      { type: "TAB_SWITCH" },
      { type: "TAB_SWITCH" },
      { type: "WINDOW_BLUR" },
      { type: "FULLSCREEN_EXIT" },
      { type: "PASTE" },
      { type: "COPY" },
      { type: "RELOAD" },
      { type: "CONTEXT_MENU" },
    ];

    const summary = summarizeEvents(events, true);

    expect(summary.totalEvents).toBe(8);
    expect(summary.tabSwitchOrBlur).toBe(3);
    expect(summary.fullscreenExit).toBe(1);
    expect(summary.paste).toBe(1);
    expect(summary.copy).toBe(1);
    expect(summary.reload).toBe(1);
    expect(summary.contextMenu).toBe(1);
    expect(summary.suspicious).toBe(true);
  });

  it("handles empty event lists gracefully", () => {
    const summary = summarizeEvents([], false);

    expect(summary.totalEvents).toBe(0);
    expect(summary.tabSwitchOrBlur).toBe(0);
    expect(summary.fullscreenExit).toBe(0);
    expect(summary.paste).toBe(0);
    expect(summary.suspicious).toBe(false);
  });
});

