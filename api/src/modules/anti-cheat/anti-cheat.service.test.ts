import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { AttemptModel } from "../attempts/attempt.model.js";
import { ExamEventModel } from "./exam-event.model.js";
import {
  evaluateSuspicious,
  getSuspiciousAttempts,
  summarizeEvents,
} from "./anti-cheat.service.js";

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

  it("counts INTERRUPTION events separately", () => {
    const summary = summarizeEvents(
      [{ type: "INTERRUPTION" }, { type: "INTERRUPTION" }, { type: "TAB_SWITCH" }],
      false
    );

    expect(summary.interruption).toBe(2);
    expect(summary.tabSwitchOrBlur).toBe(1);
    expect(summary.totalEvents).toBe(3);
  });
});

describe("getSuspiciousAttempts", () => {
  const teacherId = new mongoose.Types.ObjectId().toString();

  it("only reports attempts owned by the teacher and sorts by total events", async () => {
    const ownedAttemptId = new mongoose.Types.ObjectId();
    const foreignAttemptId = new mongoose.Types.ObjectId();

    const mockFind = {
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          _id: ownedAttemptId,
          examId: {
            _id: new mongoose.Types.ObjectId(),
            title: "Owned Exam",
            createdBy: new mongoose.Types.ObjectId(teacherId),
          },
          studentId: { fullName: "Student One", email: "s1@test.com" },
          assignmentId: null,
          submittedAt: new Date("2026-09-18"),
        },
        {
          _id: foreignAttemptId,
          examId: {
            _id: new mongoose.Types.ObjectId(),
            title: "Foreign Exam",
            createdBy: new mongoose.Types.ObjectId(),
          },
          studentId: { fullName: "Student Two", email: "s2@test.com" },
          assignmentId: null,
          submittedAt: new Date("2026-09-18"),
        },
      ]),
    };

    vi.spyOn(AttemptModel, "find").mockReturnValueOnce(mockFind as never);
    vi.spyOn(ExamEventModel, "aggregate").mockResolvedValueOnce([
      { _id: { attemptId: ownedAttemptId, type: "TAB_SWITCH" }, count: 3 },
      { _id: { attemptId: ownedAttemptId, type: "PASTE" }, count: 1 },
    ] as never);

    const result = await getSuspiciousAttempts(teacherId, "teacher", 50);

    expect(result.total).toBe(1);
    expect(result.items[0].attemptId).toBe(ownedAttemptId.toString());
    expect(result.items[0].examTitle).toBe("Owned Exam");
    expect(result.items[0].totalEvents).toBe(4);
    expect(result.items[0].eventsByType).toEqual({ TAB_SWITCH: 3, PASTE: 1 });
  });

  it("returns an empty report when nothing is suspicious", async () => {
    vi.spyOn(AttemptModel, "find").mockReturnValueOnce({
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    } as never);

    const result = await getSuspiciousAttempts(teacherId, "teacher", 50);
    expect(result).toEqual({ items: [], total: 0 });
  });
});

