import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import { QuestionModel, type IQuestion } from "./question.model.js";
import { serializeQuestion } from "./question.service.js";
import { CreateQuestionSchema, UpdateQuestionSchema } from "./question.validation.js";

const richDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
};

describe("question bank rich-text validation", () => {
  it("accepts instructionsDoc and per-question promptDoc", () => {
    const result = CreateQuestionSchema.safeParse({
      body: {
        skill: "writing",
        part: 2,
        groupType: "writing_task_2",
        instructions: "Write an essay",
        instructionsDoc: richDoc,
        config: {},
        questions: [
          {
            prompt: "Some people think...",
            promptDoc: richDoc,
            acceptedAnswers: [],
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body.instructionsDoc?.type).toBe("doc");
      expect(result.data.body.questions[0]?.promptDoc?.type).toBe("doc");
    }
  });

  it("allows a partial update that only sends instructionsDoc", () => {
    const result = UpdateQuestionSchema.safeParse({
      params: { id: "66e8621c262f3b9200000003" },
      body: { instructionsDoc: richDoc },
    });

    expect(result.success).toBe(true);
  });
});

describe("question bank rich-text serialization", () => {
  it("returns docs when present and omits them when absent", () => {
    const mockQuestion = {
      _id: new mongoose.Types.ObjectId(),
      skill: "reading",
      part: 1,
      groupType: "short_answer",
      instructions: "Answer",
      instructionsDoc: richDoc,
      config: {},
      questions: [
        {
          _id: new mongoose.Types.ObjectId(),
          prompt: "Hello",
          promptDoc: richDoc,
          acceptedAnswers: ["hello"],
          points: 1,
          mediaIds: [],
        },
        {
          _id: new mongoose.Types.ObjectId(),
          prompt: "Legacy",
          acceptedAnswers: ["legacy"],
          points: 1,
          mediaIds: [],
        },
      ],
      createdBy: new mongoose.Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as IQuestion;

    const serialized = serializeQuestion(mockQuestion);

    expect(serialized.instructionsDoc?.type).toBe("doc");
    expect(serialized.questions[0]?.promptDoc?.type).toBe("doc");
    expect(serialized.questions[1]?.promptDoc).toBeUndefined();
  });

  it("registers the doc paths on the bank schema", () => {
    expect(QuestionModel.schema.path("instructionsDoc")).toBeDefined();
    expect(QuestionModel.schema.path("questions.promptDoc")).toBeDefined();
  });
});
