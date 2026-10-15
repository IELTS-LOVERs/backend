import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAM_GRACE_PERIOD_SECONDS } from "../../config/constants.js";
import { ExamModel } from "../exams/exam.model.js";
import { AttemptModel } from "./attempt.model.js";
import { autosaveAnswers, submitAttempt } from "./attempt.service.js";

interface StoredAnswer {
  questionId: mongoose.Types.ObjectId;
  value: string;
  savedAt: Date;
}

/** Build a lightweight (non-Mongoose) attempt document for the service mocks. */
function makeAttempt(overrides: Record<string, unknown> = {}) {
  const studentId = new mongoose.Types.ObjectId().toString();
  return {
    _id: new mongoose.Types.ObjectId(),
    studentId,
    examId: new mongoose.Types.ObjectId(),
    status: "in_progress",
    expiresAt: new Date(Date.now() + 600_000),
    answers: [] as StoredAnswer[],
    scores: {},
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("autosaveAnswers (quá trình thi)", () => {
  it("lưu đáp án mới và trả về thời gian còn lại của server", async () => {
    const attempt = makeAttempt();
    vi.spyOn(AttemptModel, "findById").mockResolvedValue(attempt as never);

    const result = await autosaveAnswers(attempt._id.toString(), attempt.studentId, [
      { questionId: "q-1", value: "hello" },
      { questionId: "q-2", value: "world" },
    ]);

    expect(attempt.answers).toHaveLength(2);
    expect(attempt.answers.map((a) => a.value)).toEqual(["hello", "world"]);
    expect(result.savedCount).toBe(2);
    expect(result.serverRemainingSeconds).toBeGreaterThan(0);
    expect(attempt.save).toHaveBeenCalledTimes(1);
  });

  it("cập nhật đáp án đã có thay vì tạo bản ghi trùng (idempotent)", async () => {
    const questionId = new mongoose.Types.ObjectId();
    const attempt = makeAttempt({
      answers: [{ questionId, value: "old", savedAt: new Date(0) }],
    });
    vi.spyOn(AttemptModel, "findById").mockResolvedValue(attempt as never);

    await autosaveAnswers(attempt._id.toString(), attempt.studentId, [
      { questionId: questionId.toString(), value: "new" },
    ]);
    expect(attempt.answers).toHaveLength(1);
    expect(attempt.answers[0].value).toBe("new");

    // Gửi lại cùng câu → vẫn chỉ một bản ghi, giá trị mới nhất thắng.
    await autosaveAnswers(attempt._id.toString(), attempt.studentId, [
      { questionId: questionId.toString(), value: "newest" },
    ]);
    expect(attempt.answers).toHaveLength(1);
    expect(attempt.answers[0].value).toBe("newest");
  });

  it("từ chối EXAM_ALREADY_SUBMITTED khi bài đã nộp", async () => {
    const attempt = makeAttempt({ status: "submitted" });
    vi.spyOn(AttemptModel, "findById").mockResolvedValue(attempt as never);

    await expect(
      autosaveAnswers(attempt._id.toString(), attempt.studentId, [
        { questionId: "q-1", value: "x" },
      ])
    ).rejects.toMatchObject({ errorCode: "EXAM_ALREADY_SUBMITTED" });
    expect(attempt.save).not.toHaveBeenCalled();
  });

  it("từ chối EXAM_EXPIRED khi đã quá thời gian ân hạn", async () => {
    const attempt = makeAttempt({
      expiresAt: new Date(Date.now() - (EXAM_GRACE_PERIOD_SECONDS + 30) * 1000),
    });
    vi.spyOn(AttemptModel, "findById").mockResolvedValue(attempt as never);

    await expect(
      autosaveAnswers(attempt._id.toString(), attempt.studentId, [
        { questionId: "q-1", value: "too late" },
      ])
    ).rejects.toMatchObject({ errorCode: "EXAM_EXPIRED" });
    expect(attempt.save).not.toHaveBeenCalled();
  });

  it("vẫn lưu được trong khoảng ân hạn (vừa hết giờ nhưng chưa quá 15s)", async () => {
    const attempt = makeAttempt({ expiresAt: new Date(Date.now() - 5_000) });
    vi.spyOn(AttemptModel, "findById").mockResolvedValue(attempt as never);

    const result = await autosaveAnswers(attempt._id.toString(), attempt.studentId, [
      { questionId: "q-1", value: "late but allowed" },
    ]);

    expect(attempt.save).toHaveBeenCalledTimes(1);
    expect(result.savedCount).toBe(1);
    expect(result.serverRemainingSeconds).toBe(0);
  });

  it("bỏ qua đáp án thiếu questionId", async () => {
    const attempt = makeAttempt();
    vi.spyOn(AttemptModel, "findById").mockResolvedValue(attempt as never);

    await autosaveAnswers(attempt._id.toString(), attempt.studentId, [
      { questionId: "", value: "ignored" },
      { questionId: "q-1", value: "kept" },
    ]);

    expect(attempt.answers).toHaveLength(1);
    expect(attempt.answers[0].value).toBe("kept");
  });

  it("chặn học sinh autosave bài của người khác (ATTEMPT_NOT_OWNED)", async () => {
    const attempt = makeAttempt();
    vi.spyOn(AttemptModel, "findById").mockResolvedValue(attempt as never);

    await expect(
      autosaveAnswers(attempt._id.toString(), new mongoose.Types.ObjectId().toString(), [])
    ).rejects.toMatchObject({ errorCode: "ATTEMPT_NOT_OWNED" });
  });
});

describe("submitAttempt lifecycle", () => {
  it("nộp trong thời gian làm bài → chấm điểm và chuyển status submitted", async () => {
    const attempt = makeAttempt();
    vi.spyOn(AttemptModel, "findById").mockResolvedValue(attempt as never);
    vi.spyOn(ExamModel, "findById").mockReturnValue({
      populate: vi.fn().mockResolvedValue({
        toObject: () => ({ _id: attempt.examId, sections: [] }),
      }),
    } as never);
    vi.spyOn(AttemptModel, "findOneAndUpdate").mockResolvedValueOnce({
      _id: attempt._id,
      status: "submitted",
      submittedAt: new Date(),
      scores: {},
    } as never);

    const result = await submitAttempt(attempt._id.toString(), attempt.studentId);

    expect(result.status).toBe("submitted");
    expect(AttemptModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it("từ chối EXAM_ALREADY_SUBMITTED khi nộp lại", async () => {
    const attempt = makeAttempt({ status: "submitted" });
    vi.spyOn(AttemptModel, "findById").mockResolvedValue(attempt as never);

    await expect(submitAttempt(attempt._id.toString(), attempt.studentId)).rejects.toMatchObject(
      { errorCode: "EXAM_ALREADY_SUBMITTED" }
    );
  });
});
