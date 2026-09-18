import { describe, expect, it } from "vitest";
import { resolveSubmissionStatuses } from "./assignment.service.js";

describe("resolveSubmissionStatuses", () => {
  it("returns nothing when the student has no attempts", () => {
    const statuses = resolveSubmissionStatuses([]);

    expect(statuses.size).toBe(0);
  });

  it("maps in-progress and expired attempts per exam", () => {
    const statuses = resolveSubmissionStatuses([
      { examId: "exam-1", status: "in_progress" },
      { examId: "exam-2", status: "expired" },
    ]);

    expect(statuses.get("exam-1")).toBe("in_progress");
    expect(statuses.get("exam-2")).toBe("expired");
  });

  it("prefers submitted over in_progress and expired", () => {
    const statuses = resolveSubmissionStatuses([
      { examId: "exam-1", status: "expired" },
      { examId: "exam-1", status: "in_progress" },
      { examId: "exam-1", status: "submitted" },
    ]);

    expect(statuses.get("exam-1")).toBe("submitted");
  });

  it("prefers in_progress over expired", () => {
    const statuses = resolveSubmissionStatuses([
      { examId: "exam-1", status: "expired" },
      { examId: "exam-1", status: "in_progress" },
    ]);

    expect(statuses.get("exam-1")).toBe("in_progress");
  });

  it("records submission status by assignmentId when provided", () => {
    const statuses = resolveSubmissionStatuses([
      { assignmentId: "assign-1", examId: "exam-1", status: "submitted" },
      { assignmentId: "assign-2", examId: "exam-1", status: "in_progress" },
    ]);

    expect(statuses.get("assign-1")).toBe("submitted");
    expect(statuses.get("assign-2")).toBe("in_progress");
    expect(statuses.get("exam-1")).toBe("submitted");
  });
});
