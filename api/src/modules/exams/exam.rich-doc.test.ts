import { describe, expect, it } from "vitest";

import { CreateExamSchema, RichDocSchema } from "./exam.validation.js";

const richDoc = {
  type: "doc" as const,
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello ", marks: [{ type: "bold" }] },
        { type: "text", text: "world" },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }],
        },
      ],
    },
  ],
};

describe("RichDocSchema", () => {
  it("accepts a valid ProseMirror document", () => {
    expect(RichDocSchema.safeParse(richDoc).success).toBe(true);
  });

  it("rejects a document with a wrong root type", () => {
    expect(RichDocSchema.safeParse({ type: "paragraph", content: [] }).success).toBe(false);
  });

  it("rejects documents with too many nodes", () => {
    const content = Array.from({ length: 5_001 }, () => ({ type: "paragraph" }));
    expect(RichDocSchema.safeParse({ type: "doc", content }).success).toBe(false);
  });

  it("rejects documents nested deeper than 20 levels", () => {
    let node: Record<string, unknown> = { type: "paragraph" };
    for (let i = 0; i < 22; i += 1) {
      node = { type: "blockquote", content: [node] };
    }

    expect(RichDocSchema.safeParse({ type: "doc", content: [node] }).success).toBe(false);
  });

  it("rejects documents larger than 200KB", () => {
    const content = Array.from({ length: 5 }, () => ({
      type: "paragraph",
      content: [{ type: "text", text: "x".repeat(45_000) }],
    }));

    expect(RichDocSchema.safeParse({ type: "doc", content }).success).toBe(false);
  });
});

describe("CreateExamSchema rich-text fields", () => {
  it("accepts passageDoc, instructionsDoc, group instructionsDoc and question promptDoc", () => {
    const result = CreateExamSchema.safeParse({
      body: {
        title: "Rich text exam",
        sections: [
          {
            skill: "reading",
            part: 1,
            title: "Passage 1",
            instructions: "Read the passage",
            instructionsDoc: richDoc,
            passageText: "Hello world",
            passageDoc: richDoc,
            questionGroups: [
              {
                groupType: "short_answer",
                instructions: "Answer the questions",
                instructionsDoc: richDoc,
                config: {},
                questions: [
                  {
                    questionNumber: 1,
                    prompt: "Hello world",
                    promptDoc: richDoc,
                    acceptedAnswers: ["world"],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const section = result.data.body.sections[0];
      expect(section?.passageDoc?.type).toBe("doc");
      expect(section?.instructionsDoc?.type).toBe("doc");
      expect(section?.questionGroups?.[0]?.instructionsDoc?.type).toBe("doc");
      expect(section?.questionGroups?.[0]?.questions?.[0]?.promptDoc?.type).toBe("doc");
    }
  });

  it("rejects an invalid rich document payload", () => {
    const result = CreateExamSchema.safeParse({
      body: {
        title: "Rich text exam",
        sections: [
          {
            skill: "reading",
            part: 1,
            title: "Passage 1",
            passageDoc: { type: "not-a-doc", content: [] },
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });
});
