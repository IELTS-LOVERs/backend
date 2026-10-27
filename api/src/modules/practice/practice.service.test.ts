import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "../../common/errors/AppError.js";
import { AssignmentModel } from "../assignments/assignment.model.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { ClassModel } from "../classes/class.model.js";
import { ExamModel } from "../exams/exam.model.js";
import {
  exportWeeklyReportCsv,
  getClassWeeklyReport,
  getMondayKey,
  getPracticeCatalog,
  getPracticeHeatmap,
  toVnDateKey,
  vnDayStartUtc,
} from "./practice.service.js";

describe("Vietnam Timezone and Date Helpers", () => {
  it("converts 2026-10-22T17:30:00Z to 2026-10-23 in Vietnam timezone (UTC+7)", () => {
    const dateUtc = new Date("2026-10-22T17:30:00Z");
    const vnKey = toVnDateKey(dateUtc);
    expect(vnKey).toBe("2026-10-23");
  });

  it("converts 2026-10-22T16:59:59Z to 2026-10-22 in Vietnam timezone (UTC+7)", () => {
    const dateUtc = new Date("2026-10-22T16:59:59Z");
    const vnKey = toVnDateKey(dateUtc);
    expect(vnKey).toBe("2026-10-22");
  });

  it("correctly identifies Monday for any date", () => {
    // 2026-10-22 is Thursday -> Monday is 2026-10-19
    expect(getMondayKey("2026-10-22")).toBe("2026-10-19");
    // 2026-10-25 is Sunday -> Monday is 2026-10-19
    expect(getMondayKey("2026-10-25")).toBe("2026-10-19");
    // 2026-10-19 is Monday -> Monday is 2026-10-19
    expect(getMondayKey("2026-10-19")).toBe("2026-10-19");
  });
});

describe("Practice Catalog", () => {
  const studentId = new mongoose.Types.ObjectId().toString();

  it("returns published practice items with student progress", async () => {
    const exam1Id = new mongoose.Types.ObjectId();
    const exam2Id = new mongoose.Types.ObjectId();

    const mockExams = [
      {
        _id: exam1Id,
        title: "Cam 18 - T1 - P1",
        durationMinutes: 20,
        kind: "practice",
        curriculum: { collectionName: "Cam 18", testNumber: 1, part: 1, orderIndex: 1 },
        sections: [
          {
            skill: "reading",
            questionGroups: [
              {
                questions: [{ points: 1 }, { points: 1 }, { points: 1 }],
              },
            ],
          },
        ],
      },
      {
        _id: exam2Id,
        title: "Cam 18 - T1 - P2",
        durationMinutes: 20,
        kind: "practice",
        curriculum: { collectionName: "Cam 18", testNumber: 1, part: 2, orderIndex: 2 },
        sections: [
          {
            skill: "reading",
            questionGroups: [
              {
                questions: [{ points: 1 }, { points: 1 }],
              },
            ],
          },
        ],
      },
    ];

    vi.spyOn(ExamModel, "find").mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue(mockExams),
    } as never);

    const mockAttempts = [
      {
        _id: new mongoose.Types.ObjectId(),
        examId: exam1Id,
        status: "submitted",
        submittedAt: new Date("2026-10-20T10:00:00Z"),
        scores: { readingRaw: 3 },
        questionCount: 3,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        examId: exam2Id,
        status: "in_progress",
        startedAt: new Date(),
      },
    ];

    vi.spyOn(AttemptModel, "find").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue(mockAttempts),
    } as never);

    const result = await getPracticeCatalog(studentId, {});

    expect(result.items).toHaveLength(2);
    expect(result.items[0].progress.status).toBe("completed");
    expect(result.items[0].progress.rawScore).toBe(3);
    expect(result.items[0].progress.percentage).toBe(100);

    expect(result.items[1].progress.status).toBe("in_progress");
  });

  it("returns a writing practice with completed progress and no raw score", async () => {
    const writingExamId = new mongoose.Types.ObjectId();

    vi.spyOn(ExamModel, "find").mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([
        {
          _id: writingExamId,
          title: "Writing Task 2 - Environment",
          durationMinutes: 40,
          kind: "practice",
          sections: [
            {
              skill: "writing",
              part: 2,
              title: "Writing Task 2",
              questionGroups: [
                { groupType: "writing_task_2", questions: [{ points: 1 }] },
              ],
            },
          ],
        },
      ]),
    } as never);

    vi.spyOn(AttemptModel, "find").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([
        {
          _id: new mongoose.Types.ObjectId(),
          examId: writingExamId,
          status: "submitted",
          submittedAt: new Date("2026-10-20T10:00:00Z"),
          scores: {},
          questionCount: 0,
          totalPoints: 0,
        },
      ]),
    } as never);

    const result = await getPracticeCatalog(studentId, { skill: "writing" });

    expect(ExamModel.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ "sections.skill": "writing", status: "published" })
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].skills).toEqual(["writing"]);
    expect(result.items[0].progress.status).toBe("completed");
    expect(result.items[0].progress.rawScore).toBe(0);
    expect(result.items[0].progress.percentage).toBe(0);
  });
});

describe("Practice Heatmap", () => {
  const studentId = new mongoose.Types.ObjectId().toString();

  it("throws ForbiddenError when a student tries to view another student's heatmap", async () => {
    await expect(
      getPracticeHeatmap(
        { id: studentId, role: "student" },
        { studentId: "another-student-id" }
      )
    ).rejects.toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when teacher views student from another class", async () => {
    vi.spyOn(ClassModel, "exists").mockResolvedValueOnce(null as never);
    vi.spyOn(AssignmentModel, "exists").mockResolvedValueOnce(null as never);

    await expect(
      getPracticeHeatmap(
        { id: new mongoose.Types.ObjectId().toHexString(), role: "teacher" },
        { studentId }
      )
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows a teacher to view a student they assigned directly", async () => {
    vi.spyOn(ClassModel, "exists").mockResolvedValueOnce(null as never);
    vi.spyOn(AssignmentModel, "exists").mockResolvedValueOnce({
      _id: new mongoose.Types.ObjectId(),
    } as never);
    vi.spyOn(AttemptModel, "find").mockReturnValueOnce({
      populate: vi.fn().mockResolvedValue([]),
    } as never);

    const result = await getPracticeHeatmap(
      { id: new mongoose.Types.ObjectId().toHexString(), role: "teacher" },
      { studentId, from: "2026-10-20", to: "2026-10-20" }
    );

    expect(result.days).toHaveLength(1);
    expect(result.days[0].status).toBe("none");
  });

  it("calculates both, listening_only, reading_only, and none statuses correctly", async () => {
    // 2026-10-20: both (L + R)
    // 2026-10-21: reading only
    // 2026-10-22: none
    const attempts = [
      {
        _id: new mongoose.Types.ObjectId(),
        studentId: new mongoose.Types.ObjectId(studentId),
        examKind: "practice",
        skills: ["listening"],
        status: "submitted",
        submittedAt: new Date("2026-10-20T03:00:00Z"), // 10:00 VN
      },
      {
        _id: new mongoose.Types.ObjectId(),
        studentId: new mongoose.Types.ObjectId(studentId),
        examKind: "practice",
        skills: ["reading"],
        status: "submitted",
        submittedAt: new Date("2026-10-20T04:00:00Z"), // 11:00 VN
      },
      {
        _id: new mongoose.Types.ObjectId(),
        studentId: new mongoose.Types.ObjectId(studentId),
        examKind: "practice",
        skills: ["reading"],
        status: "submitted",
        submittedAt: new Date("2026-10-21T05:00:00Z"), // 12:00 VN
      },
      // Mock attempt on 2026-10-21 should be ignored:
      {
        _id: new mongoose.Types.ObjectId(),
        studentId: new mongoose.Types.ObjectId(studentId),
        examKind: "mock",
        skills: ["listening"],
        status: "submitted",
        submittedAt: new Date("2026-10-21T06:00:00Z"),
      },
    ];

    vi.spyOn(AttemptModel, "find").mockReturnValueOnce({
      populate: vi.fn().mockResolvedValue(attempts),
    } as never);

    const result = await getPracticeHeatmap(
      { id: studentId, role: "student" },
      { from: "2026-10-20", to: "2026-10-22" }
    );

    expect(result.days).toHaveLength(3);
    const day20 = result.days.find((d) => d.date === "2026-10-20");
    const day21 = result.days.find((d) => d.date === "2026-10-21");
    const day22 = result.days.find((d) => d.date === "2026-10-22");

    expect(day20?.status).toBe("both");
    expect(day20?.listening).toBe(1);
    expect(day20?.reading).toBe(1);

    expect(day21?.status).toBe("reading_only");
    expect(day21?.listening).toBe(0);
    expect(day21?.reading).toBe(1);

    expect(day22?.status).toBe("none");
  });

  it("counts writing practice attempts separately from listening/reading", async () => {
    vi.spyOn(AttemptModel, "find").mockReturnValueOnce({
      populate: vi.fn().mockResolvedValue([
        {
          _id: new mongoose.Types.ObjectId(),
          studentId: new mongoose.Types.ObjectId(studentId),
          examKind: "practice",
          skills: ["writing"],
          status: "submitted",
          submittedAt: new Date("2026-10-22T03:00:00Z"), // 10:00 VN
          examId: { kind: "practice", sections: [{ skill: "writing" }] },
        },
        {
          _id: new mongoose.Types.ObjectId(),
          studentId: new mongoose.Types.ObjectId(studentId),
          examKind: "practice",
          skills: ["reading", "writing"],
          status: "submitted",
          submittedAt: new Date("2026-10-22T04:00:00Z"),
          examId: { kind: "practice", sections: [{ skill: "reading" }, { skill: "writing" }] },
        },
      ]),
    } as never);

    const result = await getPracticeHeatmap(
      { id: studentId, role: "student" },
      { from: "2026-10-22", to: "2026-10-22" }
    );

    expect(result.days[0].writing).toBe(2);
    expect(result.days[0].reading).toBe(1);
    // The heatmap status stays keyed on listening/reading.
    expect(result.days[0].status).toBe("reading_only");
  });
});

describe("Weekly Report & CSV", () => {
  it("formats CSV correctly with Vietnamese header and escapes cells", () => {
    const mockReport = {
      class: { id: "c1", name: "IELTS Fighter", code: "IF-01" },
      week: { from: "2026-10-19", to: "2026-10-25", timezone: "Asia/Ho_Chi_Minh" },
      students: [
        {
          student: { id: "s1", fullName: "Nguyễn, Văn A" },
          days: [
            { date: "2026-10-19", status: "both" as const, listening: 1, reading: 1, practiceCount: 2, mockCount: 0 },
            { date: "2026-10-20", status: "reading_only" as const, listening: 0, reading: 1, practiceCount: 1, mockCount: 0 },
            { date: "2026-10-21", status: "none" as const, listening: 0, reading: 0, practiceCount: 0, mockCount: 0 },
            { date: "2026-10-22", status: "none" as const, listening: 0, reading: 0, practiceCount: 0, mockCount: 0 },
            { date: "2026-10-23", status: "none" as const, listening: 0, reading: 0, practiceCount: 0, mockCount: 0 },
            { date: "2026-10-24", status: "none" as const, listening: 0, reading: 0, practiceCount: 0, mockCount: 0 },
            { date: "2026-10-25", status: "none" as const, listening: 0, reading: 0, practiceCount: 0, mockCount: 0 },
          ],
          assignmentsDue: 3,
          assignmentsCompleted: 2,
          completionRate: 0.67,
          practiceAttempts: 3,
          practiceAccuracy: 85,
          mockAverageBand: 6.5,
        },
      ],
      totals: {
        students: 1,
        assignmentsDue: 3,
        assignmentsCompleted: 2,
        completionRate: 0.67,
      },
    };

    const csv = exportWeeklyReportCsv(mockReport);
    expect(csv).toContain("Học sinh,Thứ 2,Thứ 3,Thứ 4,Thứ 5,Thứ 6,Thứ 7,Chủ nhật,Bài tập đến hạn,Bài tập đã nộp,Tỷ lệ hoàn thành,Bài luyện tập,Độ chính xác luyện tập,Điểm TB đề thi");
    expect(csv).toContain('"Nguyễn, Van A"'.replace("Van", "Văn"));
    expect(csv).toContain("L1/R1");
    expect(csv).toContain("R1");
    expect(csv).toContain("67%");
    expect(csv).toContain("85%");
    expect(csv).toContain("6.5");
  });
});
