import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { BadRequestError, ForbiddenError } from "../../common/errors/AppError.js";
import { AssignmentModel } from "../assignments/assignment.model.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { ClassModel } from "../classes/class.model.js";
import { ExamModel } from "./exam.model.js";
import { canStudentAccessExam } from "./exam.access.js";
import {
  assertOwnership,
  clone,
  getById,
  list,
  mapSections,
  publish,
  unpublish,
  update,
  updateMetadata,
} from "./exam.service.js";

describe("mapSections", () => {
  it("converts hex strings to ObjectIds for mediaIds and group ids", () => {
    const groupId = new mongoose.Types.ObjectId().toString();
    const m1 = new mongoose.Types.ObjectId().toString();

    const sections = mapSections([
      {
        skill: "listening",
        part: 1,
        title: "Section 1",
        instructions: "Listen carefully",
        passageText: undefined,
        mediaIds: [m1],
        questionGroups: [
          {
            _id: groupId,
            groupType: "form_completion",
            instructions: "Complete the notes.",
            config: { maxWords: 1 },
            questions: [
              {
                questionNumber: 1,
                prompt: "City: [1]",
                acceptedAnswers: ["london"],
                points: 1,
                mediaIds: [],
              },
            ],
          },
        ],
      },
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].skill).toBe("listening");
    expect(sections[0].part).toBe(1);
    expect(sections[0].mediaIds?.[0].toString()).toBe(m1);
    expect(sections[0].questionGroups).toHaveLength(1);
    expect(sections[0].questionGroups[0].groupType).toBe("form_completion");
    expect(sections[0].questionGroups[0]._id?.toString()).toBe(groupId);
  });
});

describe("assertOwnership", () => {
  const creatorId = new mongoose.Types.ObjectId();

  it("permits admin role to manage any exam", () => {
    const exam = { createdBy: creatorId };
    expect(() => assertOwnership(exam, "admin-user", "admin")).not.toThrow();
  });

  it("permits the creator teacher to manage their exam", () => {
    const exam = { createdBy: creatorId };
    expect(() => assertOwnership(exam, creatorId.toString(), "teacher")).not.toThrow();
  });

  it("throws ForbiddenError for a non-owner teacher", () => {
    const exam = { createdBy: creatorId };
    expect(() => assertOwnership(exam, "stranger-teacher", "teacher")).toThrow(ForbiddenError);
  });
});

describe("publish and unpublish", () => {
  const teacherId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();

  it("throws BadRequestError (EXAM_EMPTY) when publishing exam with no sections", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      sections: [],
      status: "draft",
      save: vi.fn(),
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);

    await expect(publish(examId.toString(), teacherId.toString(), "teacher")).rejects.toThrow(
      BadRequestError
    );
  });

  it("throws BadRequestError (EXAM_EMPTY) when sections have 0 questions", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      sections: [{ questionGroups: [] }],
      status: "draft",
      save: vi.fn(),
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);

    await expect(publish(examId.toString(), teacherId.toString(), "teacher")).rejects.toThrow(
      BadRequestError
    );
  });

  it("publishes successfully when sections have at least one question", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      sections: [
        {
          skill: "listening",
          questionGroups: [
            {
              groupType: "short_answer",
              questions: [
                { questionNumber: 1, prompt: "Q1", acceptedAnswers: ["answer"], points: 40 },
              ],
            },
          ],
        },
      ],
      status: "draft",
      save: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);

    const result = await publish(examId.toString(), teacherId.toString(), "teacher");
    expect(result.status).toBe("published");
    expect(mockExam.status).toBe("published");
    expect(mockExam.save).toHaveBeenCalled();
  });

  it("throws BadRequestError (EXAM_EMPTY) when practice has 0 sections", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      kind: "practice",
      sections: [],
      status: "draft",
      save: vi.fn(),
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);

    await expect(publish(examId.toString(), teacherId.toString(), "teacher")).rejects.toThrow(
      "Đề thi phải có ít nhất một câu hỏi để xuất bản."
    );
  });

  it("allows practice exam with multiple sections (multi-part)", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      kind: "practice",
      scoringMode: "raw",
      sections: [
        { skill: "reading", part: 1, questionGroups: [{ questions: [{ questionNumber: 1, acceptedAnswers: ["a"] }] }] },
        { skill: "reading", part: 2, questionGroups: [{ questions: [{ questionNumber: 2, acceptedAnswers: ["b"] }] }] },
      ],
      status: "draft",
      save: vi.fn().mockResolvedValue(true),
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);

    const result = await publish(examId.toString(), teacherId.toString(), "teacher");
    expect(result.status).toBe("published");
  });

  it("throws BadRequestError (PRACTICE_INVALID_SKILL) when practice has writing skill", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      kind: "practice",
      sections: [
        { skill: "writing", questionGroups: [{ questions: [{ questionNumber: 1, acceptedAnswers: ["a"] }] }] },
      ],
      status: "draft",
      save: vi.fn(),
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);

    await expect(publish(examId.toString(), teacherId.toString(), "teacher")).rejects.toThrow(
      "Bài luyện tập chỉ hỗ trợ kỹ năng Listening hoặc Reading."
    );
  });

  it("forces practice scoringMode to raw on publish (legacy band data)", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      kind: "practice",
      scoringMode: "band",
      bandConversion: { mode: "auto", readingType: "academic" },
      sections: [
        { skill: "reading", questionGroups: [{ questions: [{ questionNumber: 1, points: 13, acceptedAnswers: ["a"] }] }] },
      ],
      status: "draft",
      save: vi.fn(),
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);

    await expect(publish(examId.toString(), teacherId.toString(), "teacher")).resolves.toMatchObject({
      status: "published",
    });
    expect(mockExam.scoringMode).toBe("raw");
    expect(mockExam.bandConversion).toBeUndefined();
  });

  it("throws BadRequestError (CURRICULUM_PART_MISMATCH) when curriculum.part != section.part", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      kind: "practice",
      curriculum: { part: 2 },
      sections: [
        { part: 1, skill: "reading", questionGroups: [{ questions: [{ questionNumber: 1, acceptedAnswers: ["a"] }] }] },
      ],
      status: "draft",
      save: vi.fn(),
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);

    await expect(publish(examId.toString(), teacherId.toString(), "teacher")).rejects.toThrow(
      "Phần curriculum.part (2) phải khớp với phần thi (1)."
    );
  });

  it("throws BadRequestError (EXAM_NOT_PUBLISHED) when unpublishing non-published exam", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      status: "draft",
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);

    await expect(unpublish(examId.toString(), teacherId.toString(), "teacher")).rejects.toThrow(
      BadRequestError
    );
  });

  it("throws BadRequestError (EXAM_HAS_ATTEMPTS) when unpublishing exam with student attempts", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      status: "published",
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);
    vi.spyOn(AttemptModel, "countDocuments").mockResolvedValueOnce(2 as never);

    await expect(unpublish(examId.toString(), teacherId.toString(), "teacher")).rejects.toThrow(
      BadRequestError
    );
  });

  it("unpublishes successfully when published and has 0 attempts", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      status: "published",
      save: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);
    vi.spyOn(AttemptModel, "countDocuments").mockResolvedValueOnce(0 as never);

    const result = await unpublish(examId.toString(), teacherId.toString(), "teacher");
    expect(result.status).toBe("draft");
    expect(mockExam.status).toBe("draft");
    expect(mockExam.save).toHaveBeenCalled();
  });
});

describe("student access to exams", () => {
  const studentId = new mongoose.Types.ObjectId().toString();

  it("forces status 'published' and only assigned exam ids when role is student in list", async () => {
    const classId = new mongoose.Types.ObjectId();
    const assignedExamId = new mongoose.Types.ObjectId();

    vi.spyOn(ClassModel, "find").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([{ _id: classId }]),
    } as never);
    vi.spyOn(AssignmentModel, "find").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([{ examId: assignedExamId }]),
    } as never);

    let capturedQuery: unknown;
    vi.spyOn(ExamModel, "find").mockImplementationOnce((query: unknown) => {
      capturedQuery = query;
      return {
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as never;
    });
    vi.spyOn(ExamModel, "countDocuments").mockResolvedValueOnce(0 as never);

    await list(studentId, "student", { page: 1, limit: 10 });
    expect(capturedQuery).toEqual({
      status: "published",
      _id: { $in: [assignedExamId] },
    });
  });

  it("throws ForbiddenError when student tries to get non-published exam", async () => {
    const draftExam = {
      _id: new mongoose.Types.ObjectId(),
      status: "draft",
      sections: [],
    };
    vi.spyOn(ExamModel, "findById").mockReturnValue({
      populate: vi.fn().mockResolvedValue(draftExam),
    } as never);

    await expect(getById("exam-123", studentId, "student")).rejects.toThrow(ForbiddenError);
  });
});

describe("BUG-01 student exam projection", () => {
  const studentId = new mongoose.Types.ObjectId().toString();

  it("strips acceptedAnswers and explanation for students", async () => {
    const examId = new mongoose.Types.ObjectId();
    const questionId = new mongoose.Types.ObjectId();
    const examDoc = {
      _id: examId,
      title: "Mock",
      durationMinutes: 60,
      status: "published",
      createdBy: new mongoose.Types.ObjectId(),
      toObject: () => ({
        _id: examId,
        title: "Mock",
        sections: [
          {
            skill: "listening",
            part: 1,
            title: "S1",
            mediaIds: [],
            questionGroups: [
              {
                groupType: "form_completion",
                instructions: "Complete the notes.",
                config: {},
                questions: [
                  {
                    _id: questionId,
                    questionNumber: 1,
                    prompt: "City?",
                    acceptedAnswers: ["london"],
                    explanation: "because the speaker said so",
                    mediaIds: [],
                    points: 1,
                  },
                ],
              },
            ],
          },
        ],
      }),
    };
    vi.spyOn(ExamModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockResolvedValue(examDoc),
    } as never);

    const result = await getById(examId.toString(), studentId, "student");
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("acceptedAnswers");
    expect(serialized).not.toContain("explanation");
    expect(serialized).not.toContain("london");
    expect((result as { durationMinutes: number }).durationMinutes).toBe(60);
    expect((result as { status: string }).status).toBe("published");
  });

  it("denies a non-owner teacher even for published exams", async () => {
    const publishedExam = {
      _id: new mongoose.Types.ObjectId(),
      status: "published",
      createdBy: new mongoose.Types.ObjectId(),
      sections: [],
    };
    vi.spyOn(ExamModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockResolvedValue(publishedExam),
    } as never);

    await expect(getById("exam-123", "stranger-teacher", "teacher")).rejects.toThrow(
      ForbiddenError
    );
  });
});

describe("BUG-04 clone ownership", () => {
  it("denies cloning an exam owned by another teacher", async () => {
    const original = {
      _id: new mongoose.Types.ObjectId(),
      createdBy: new mongoose.Types.ObjectId(),
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(original as never);

    await expect(
      clone(original._id.toString(), "stranger-teacher", "teacher")
    ).rejects.toThrow(ForbiddenError);
  });

  it("copies kind, scoringMode, curriculum, and postSubmissionResources when cloning", async () => {
    const teacherId = new mongoose.Types.ObjectId();
    const original = {
      _id: new mongoose.Types.ObjectId(),
      title: "Test Exam",
      description: "Description",
      kind: "practice",
      scoringMode: "raw",
      curriculum: { collectionName: "Cam 18", testNumber: 1, part: 1, orderIndex: 1 },
      postSubmissionResources: { solutionVideoUrl: "https://youtube.com/watch?v=123" },
      durationMinutes: 20,
      sections: [],
      openAt: undefined,
      closeAt: undefined,
      createdBy: teacherId,
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(original as never);

    let createArgs: unknown;
    vi.spyOn(ExamModel, "create").mockImplementationOnce((args: unknown) => {
      createArgs = args;
      return {
        _id: new mongoose.Types.ObjectId(),
        title: (args as { title: string }).title,
        status: "draft",
      } as never;
    });

    const result = await clone(original._id.toString(), teacherId.toString(), "teacher");
    expect(result.status).toBe("draft");
    expect(result.title).toBe("[Bản sao] Test Exam");
    expect(createArgs).toMatchObject({
      kind: "practice",
      scoringMode: "raw",
      curriculum: original.curriculum,
      postSubmissionResources: original.postSubmissionResources,
    });
  });
});

describe("Exam kind immutability", () => {
  const teacherId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();

  it("throws EXAM_KIND_IMMUTABLE when updating kind on published exam via updateMetadata", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      kind: "mock",
      status: "published",
      save: vi.fn(),
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);

    await expect(
      updateMetadata(examId.toString(), { kind: "practice" }, teacherId.toString(), "teacher")
    ).rejects.toThrow("Không thể thay đổi loại đề thi sau khi đã xuất bản.");
  });

  it("throws EXAM_KIND_IMMUTABLE when updating kind on draft exam with existing attempts", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      kind: "mock",
      status: "draft",
      save: vi.fn(),
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);
    vi.spyOn(AssignmentModel, "exists").mockResolvedValueOnce(null as never);
    vi.spyOn(AttemptModel, "exists").mockResolvedValueOnce({ _id: new mongoose.Types.ObjectId() } as never);

    await expect(
      update(examId.toString(), { kind: "practice" }, teacherId.toString(), "teacher")
    ).rejects.toThrow("Không thể thay đổi loại đề thi sau khi đã có bài tập hoặc lượt làm bài.");
  });
});

describe("scoringMode immutability", () => {
  const teacherId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();

  it("blocks changing scoringMode once attempts exist", async () => {
    const mockExam = {
      _id: examId,
      createdBy: teacherId,
      kind: "mock",
      status: "published",
      scoringMode: "band",
      sections: [],
      save: vi.fn(),
    };
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce(mockExam as never);
    vi.spyOn(AttemptModel, "exists").mockResolvedValueOnce({
      _id: new mongoose.Types.ObjectId(),
    } as never);

    await expect(
      updateMetadata(examId.toString(), { scoringMode: "raw" }, teacherId.toString(), "teacher")
    ).rejects.toThrow("Không thể thay đổi cách chấm điểm sau khi đã có lượt làm bài.");
  });
});

describe("closed exam student access", () => {
  const studentId = new mongoose.Types.ObjectId().toString();
  const examId = new mongoose.Types.ObjectId();

  it("allows a closed exam when the student already has an attempt", async () => {
    vi.spyOn(AttemptModel, "exists").mockResolvedValueOnce({
      _id: new mongoose.Types.ObjectId(),
    } as never);

    await expect(
      canStudentAccessExam(studentId, {
        _id: examId,
        status: "closed",
        kind: "mock",
        createdBy: new mongoose.Types.ObjectId(),
      } as never)
    ).resolves.toBe(true);
  });

  it("denies a closed exam when the student never attempted it", async () => {
    vi.spyOn(AttemptModel, "exists").mockResolvedValueOnce(null as never);

    await expect(
      canStudentAccessExam(studentId, {
        _id: examId,
        status: "closed",
        kind: "practice",
        createdBy: new mongoose.Types.ObjectId(),
      } as never)
    ).resolves.toBe(false);
  });
});
