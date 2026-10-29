import { describe, expect, it } from "vitest";

import {
  collectMultiSelectKeys,
  gradeMultiSelectAnswer,
} from "./multi-select.js";

describe("collectMultiSelectKeys", () => {
  it("unions the accepted letters of every question in the group", () => {
    const keys = collectMultiSelectKeys([
      { acceptedAnswers: ["A"] },
      { acceptedAnswers: ["E"] },
    ]);

    expect([...keys].sort()).toEqual(["A", "E"]);
  });

  it("ignores blank answers and missing arrays", () => {
    const keys = collectMultiSelectKeys([
      { acceptedAnswers: ["A", "", "  "] },
      {},
      { acceptedAnswers: null },
    ]);

    expect([...keys]).toEqual(["A"]);
  });
});

describe("gradeMultiSelectAnswer", () => {
  const keys = new Set(["A", "E"]);

  it("accepts a correct letter regardless of its position", () => {
    expect(gradeMultiSelectAnswer("A", keys, new Set())).toBe(true);
    expect(gradeMultiSelectAnswer("E", keys, new Set())).toBe(true);
  });

  it("rejects a letter outside the group key", () => {
    expect(gradeMultiSelectAnswer("C", keys, new Set())).toBe(false);
  });

  it("rejects the same letter being claimed twice", () => {
    const seen = new Set<string>();

    expect(gradeMultiSelectAnswer("A", keys, seen)).toBe(true);
    expect(gradeMultiSelectAnswer("A", keys, seen)).toBe(false);
  });

  it("still grades legacy single-box answers stored as \"A, E\"", () => {
    expect(gradeMultiSelectAnswer("A, E", keys)).toBe(true);
    expect(gradeMultiSelectAnswer("E, A", keys)).toBe(true);
    expect(gradeMultiSelectAnswer("A, C", keys)).toBe(false);
  });

  it("rejects blanks and groups without a key", () => {
    expect(gradeMultiSelectAnswer("", keys)).toBe(false);
    expect(gradeMultiSelectAnswer("  ", keys)).toBe(false);
    expect(gradeMultiSelectAnswer("A", new Set())).toBe(false);
  });
});
