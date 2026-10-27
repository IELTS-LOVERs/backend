import { describe, expect, it } from "vitest";
import {
  alignTemplateNumbers,
  extractTemplateNumbers,
  normalizeExamSectionNumbering,
  rewriteTemplateNumbers,
} from "./exam-numbering.js";

function section(
  skill: "listening" | "reading" | "writing",
  groups: Array<{
    config?: Record<string, unknown>;
    numbers: number[];
  }>
) {
  return {
    skill,
    questionGroups: groups.map((group, groupIndex) => ({
      _id: `g${groupIndex}`,
      groupType: "form_completion",
      config: group.config ?? {},
      questions: group.numbers.map((questionNumber, questionIndex) => ({
        _id: `q${groupIndex}-${questionIndex}`,
        questionNumber,
        prompt: "",
        acceptedAnswers: [],
      })),
    })),
  };
}

describe("rewriteTemplateNumbers", () => {
  it("rewrites every blank syntax while keeping its style", () => {
    const remap = new Map([
      [1, 6],
      [2, 7],
    ]);

    expect(rewriteTemplateNumbers("A [1] B [q2] C {{1}} D {{q2}}", remap)).toBe(
      "A [6] B [q7] C {{6}} D {{q7}}"
    );
  });

  it("leaves unknown numbers and plain text untouched", () => {
    expect(rewriteTemplateNumbers("Keep [9] and 12.", new Map([[1, 2]]))).toBe(
      "Keep [9] and 12."
    );
  });
});

describe("extractTemplateNumbers / alignTemplateNumbers", () => {
  it("extracts distinct ascending blank numbers", () => {
    expect(extractTemplateNumbers("[3] [1] {{q2}} [3]")).toEqual([1, 2, 3]);
    expect(extractTemplateNumbers("")).toEqual([]);
  });

  it("maps local bank-group blanks onto renumbered questions", () => {
    expect(
      alignTemplateNumbers(
        "Name: [1]\nCity: [2]\nPhone: [3]",
        [1, 2, 3],
        [21, 22, 23]
      )
    ).toBe("Name: [21]\nCity: [22]\nPhone: [23]");
  });

  it("preserves an already aligned template", () => {
    const template = "Name: [21]\nCity: [22]";
    expect(alignTemplateNumbers(template, [21, 22], [21, 22])).toBe(template);
  });

  it("keeps extra blanks that have no matching question", () => {
    expect(
      alignTemplateNumbers("[1] [2] [9]", [1, 2], [5, 6])
    ).toBe("[5] [6] [9]");
  });
});

describe("normalizeExamSectionNumbering", () => {
  it("renumbers continuously per skill across sections and groups", () => {
    const result = normalizeExamSectionNumbering([
      section("listening", [{ numbers: [1, 2] }, { numbers: [7] }]),
      section("listening", [{ numbers: [1, 2, 3] }]),
    ]);

    expect(result.changed).toBe(true);
    expect(
      result.sections.flatMap((item) =>
        (item.questionGroups ?? []).flatMap((group) =>
          (group.questions ?? []).map((question) => question.questionNumber)
        )
      )
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("restarts numbering for each skill", () => {
    const result = normalizeExamSectionNumbering([
      section("listening", [{ numbers: [1, 2] }]),
      section("reading", [{ numbers: [1, 2] }]),
      section("writing", [{ numbers: [1] }]),
    ]);

    expect(result.changed).toBe(false);
    expect(
      result.sections.map(
        (item) => item.questionGroups?.[0]?.questions?.[0]?.questionNumber
      )
    ).toEqual([1, 1, 1]);
  });

  it("rewrites a completion template to the new global numbers", () => {
    const result = normalizeExamSectionNumbering([
      section("listening", [{ numbers: [1, 2, 3] }]),
      section("listening", [
        {
          config: { template: "Name: [1]\nCity: [2]\nPhone: [3]" },
          numbers: [1, 2, 3],
        },
      ]),
    ]);

    expect(result.changed).toBe(true);
    expect(result.sections[1].questionGroups?.[0]?.config?.template).toBe(
      "Name: [4]\nCity: [5]\nPhone: [6]"
    );
  });

  it("rewrites a local template even when the numbers are already canonical", () => {
    const result = normalizeExamSectionNumbering([
      section("listening", [
        {
          config: { template: "Name: [1]\nCity: [2]" },
          numbers: [1, 2],
        },
        {
          config: { template: "Age: [1]\nJob: [2]" },
          numbers: [3, 4],
        },
      ]),
    ]);

    expect(result.changed).toBe(true);
    expect(result.sections[0].questionGroups?.[1]?.config?.template).toBe(
      "Age: [3]\nJob: [4]"
    );
  });

  it("returns the same data when numbering is already canonical", () => {
    const input = [
      section("listening", [{ numbers: [1, 2] }]),
      section("reading", [{ numbers: [1, 2] }]),
    ];

    const result = normalizeExamSectionNumbering(input);

    expect(result.changed).toBe(false);
    expect(result.sections).toEqual(input);
  });

  it("handles empty sections and groups", () => {
    const result = normalizeExamSectionNumbering([
      { skill: "listening", questionGroups: [] },
      section("listening", [{ numbers: [] }]),
    ]);

    expect(result.changed).toBe(false);
    expect(result.sections).toHaveLength(2);
  });
});
