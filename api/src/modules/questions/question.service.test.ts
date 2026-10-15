import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { ExamModel } from "../exams/exam.model.js";
import { QuestionModel, type IQuestion } from "./question.model.js";
import { assertOwner, getById, list, remove, serializeQuestion } from "./question.service.js";

describe("serializeQuestion", () => {
  it("serializes a bank question group and normalizes null fields", () => {
    const groupId = new mongoose.Types.ObjectId();
    const itemId = new mongoose.Types.ObjectId();
    const mediaId = new mongoose.Types.ObjectId();
    const creatorId = new mongoose.Types.ObjectId();
    const now = new Date();

    const mockQuestion = {
      _id: groupId,
      skill: "listening",
      part: 1,
      groupType: "multiple_choice_single",
      instructions: "Choose the correct answer",
      config: { options: [{ id: "A", text: "One" }] },
      questions: [
        {
          _id: itemId,
          prompt: "Pick one",
          acceptedAnswers: ["A"],
          points: 1,
          explanation: undefined,
          mediaIds: [mediaId],
        },
      ],
      createdBy: creatorId,
      createdAt: now,
      updatedAt: now,
    } as unknown as IQuestion;

    const serialized = serializeQuestion(mockQuestion);

    expect(serialized.id).toBe(groupId.toString());
    expect(serialized.skill).toBe("listening");
    expect(serialized.groupType).toBe("multiple_choice_single");
    expect(serialized.part).toBe(1);
    expect(serialized.instructions).toBe("Choose the correct answer");
    expect(serialized.questionCount).toBe(1);
    expect(serialized.questions[0].id).toBe(itemId.toString());
    expect(serialized.questions[0].mediaIds).toEqual([mediaId.toString()]);
    expect(serialized.questions[0].explanation).toBeNull();
    expect(serialized.createdBy).toBe(creatorId.toString());
  });
});

describe("assertOwner", () => {
  const creatorId = new mongoose.Types.ObjectId();

  it("permits admin role to access any question", () => {
    const question = { createdBy: creatorId };
    expect(() => assertOwner(question, "different-user-id", "admin")).not.toThrow();
  });

  it("permits owner teacher to access their own question", () => {
    const question = { createdBy: creatorId };
    expect(() => assertOwner(question, creatorId.toString(), "teacher")).not.toThrow();
  });

  it("throws ForbiddenError for non-owner teacher", () => {
    const question = { createdBy: creatorId };
    expect(() => assertOwner(question, "other-teacher-id", "teacher")).toThrow(ForbiddenError);
  });
});

describe("list questions with search", () => {
  it("builds an $or regex query across instructions and question prompts", async () => {
    let capturedQuery: unknown;
    const mockFind = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(QuestionModel, "find").mockImplementationOnce((query) => {
      capturedQuery = query;
      return mockFind as never;
    });
    vi.spyOn(QuestionModel, "countDocuments").mockResolvedValueOnce(0 as never);

    await list({
      page: 1,
      limit: 20,
      search: "environment",
    });

    expect(capturedQuery).toBeDefined();
    const queryObj = capturedQuery as { $or?: Array<Record<string, RegExp>> };
    expect(queryObj.$or).toHaveLength(2);
    expect(queryObj.$or?.[0].instructions?.source).toBe("environment");
    expect(queryObj.$or?.[0].instructions?.flags).toContain("i");
    expect(queryObj.$or?.[1]["questions.prompt"]?.source).toBe("environment");
    expect(queryObj.$or?.[1]["questions.prompt"]?.flags).toContain("i");
  });

  it("escapes regex metacharacters so invalid patterns cannot throw (logic fix)", async () => {
    const runList = async (search: string) => {
      let capturedQuery: unknown;
      const mockFind = {
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      vi.spyOn(QuestionModel, "find").mockImplementationOnce((query) => {
        capturedQuery = query;
        return mockFind as never;
      });
      vi.spyOn(QuestionModel, "countDocuments").mockResolvedValueOnce(0 as never);

      const result = await list({ page: 1, limit: 20, search });
      return { result, capturedQuery };
    };

    // Before the fix this threw SyntaxError (invalid regex) → HTTP 500.
    const invalid = await runList("[");
    expect(invalid.result).toBeDefined();
    expect(
      (invalid.capturedQuery as { $or?: Array<Record<string, RegExp>> }).$or?.[0].instructions?.source
    ).toBe("\\[");

    // Catastrophic-backtracking input must be treated as a literal too.
    const redos = await runList("(a+)+$");
    expect(redos.result).toBeDefined();
    expect(
      (redos.capturedQuery as { $or?: Array<Record<string, RegExp>> }).$or?.[0].instructions?.source
    ).toBe("\\(a\\+\\)\\+\\$");
  });
});

describe("remove question referential integrity", () => {
  const questionId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  it("throws NotFoundError when the question does not exist", async () => {
    vi.spyOn(QuestionModel, "findById").mockResolvedValueOnce(null as never);

    await expect(remove(questionId.toString(), userId.toString(), "teacher")).rejects.toThrow(
      NotFoundError
    );
  });

  it("deletes the question when it is not used by any published or closed exam", async () => {
    vi.spyOn(QuestionModel, "findById").mockResolvedValueOnce({
      _id: questionId,
      createdBy: userId,
    } as never);
    const deleteSpy = vi
      .spyOn(QuestionModel, "deleteOne")
      .mockResolvedValueOnce({ acknowledged: true, deletedCount: 1 } as never);

    await remove(questionId.toString(), userId.toString(), "teacher");

    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });
});

describe("BUG-08 question bank scope", () => {
  const teacherId = new mongoose.Types.ObjectId().toString();
  const otherTeacherId = new mongoose.Types.ObjectId().toString();

  function mockQuestionDoc() {
    const groupId = new mongoose.Types.ObjectId();
    const now = new Date();

    return {
      _id: groupId,
      skill: "reading",
      part: 1,
      groupType: "multiple_choice_single",
      instructions: "Pick one",
      config: {},
      questions: [
        {
          _id: new mongoose.Types.ObjectId(),
          prompt: "Pick one",
          acceptedAnswers: ["A"],
          points: 1,
          mediaIds: [],
        },
      ],
      createdBy: new mongoose.Types.ObjectId(otherTeacherId),
      createdAt: now,
      updatedAt: now,
    };
  }

  it("defaults to own questions for teachers in list", async () => {
    let capturedQuery: Record<string, unknown> | undefined;
    const mockFind = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(QuestionModel, "find").mockImplementationOnce((query) => {
      capturedQuery = query as Record<string, unknown>;
      return mockFind as never;
    });
    vi.spyOn(QuestionModel, "countDocuments").mockResolvedValueOnce(0 as never);

    await list({ page: 1, limit: 20 }, teacherId, "teacher");

    expect(capturedQuery?.createdBy).toBe(teacherId);
  });

  it("allows scope=all to query the shared question bank", async () => {
    let capturedQuery: Record<string, unknown> | undefined;
    const mockFind = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(QuestionModel, "find").mockImplementationOnce((query) => {
      capturedQuery = query as Record<string, unknown>;
      return mockFind as never;
    });
    vi.spyOn(QuestionModel, "countDocuments").mockResolvedValueOnce(0 as never);

    await list({ page: 1, limit: 20, scope: "all" }, teacherId, "teacher");

    expect(capturedQuery?.createdBy).toBeUndefined();
  });

  it("denies reading another teacher's question by default", async () => {
    vi.spyOn(QuestionModel, "findById").mockResolvedValueOnce(mockQuestionDoc() as never);

    await expect(getById("question-1", teacherId, "teacher")).rejects.toThrow(
      ForbiddenError
    );
  });

  it("allows scope=all and admin to read another teacher's question", async () => {
    vi.spyOn(QuestionModel, "findById").mockResolvedValueOnce(mockQuestionDoc() as never);
    const shared = await getById("question-1", teacherId, "teacher", "all");
    expect(shared.questions[0].prompt).toBe("Pick one");

    vi.spyOn(QuestionModel, "findById").mockResolvedValueOnce(mockQuestionDoc() as never);
    const adminView = await getById("question-1", "admin-1", "admin");
    expect(adminView.questions[0].prompt).toBe("Pick one");
  });
});
