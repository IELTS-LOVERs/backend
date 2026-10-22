import { describe, expect, it } from "vitest";
import { matchAnswer, normalizeAnswer } from "./string-normalizer.js";

describe("normalizeAnswer", () => {
  it("trims and collapses whitespace while preserving case", () => {
    expect(normalizeAnswer(" London  ")).toBe("London");
    expect(normalizeAnswer("New   York")).toBe("New York");
    expect(normalizeAnswer("line\nbreak")).toBe("line break");
  });

  it("normalizes typographic quotes", () => {
    expect(normalizeAnswer("it\u2019s")).toBe("it's");
  });

  it("strips punctuation that does not affect meaning", () => {
    expect(normalizeAnswer("the theatre,")).toBe("the theatre");
    expect(normalizeAnswer("the theatre.")).toBe("the theatre");
    expect(normalizeAnswer("(student)")).toBe("student");
  });

  it("keeps hyphens and slashes", () => {
    expect(normalizeAnswer("well-known")).toBe("well-known");
    expect(normalizeAnswer("and/or")).toBe("and/or");
  });

  it("preserves decimal dots between digits while distinguishing from integers", () => {
    expect(normalizeAnswer("1.5")).toBe("1.5");
    expect(normalizeAnswer("15")).toBe("15");
    expect(normalizeAnswer("15.")).toBe("15");
    expect(normalizeAnswer("2.75 million")).toBe("2.75 million");
  });
});

describe("matchAnswer", () => {
  it("matches any accepted answer with the same casing", () => {
    const accepted = ["student centre", "student center"];
    expect(matchAnswer(" student center ", accepted)).toBe(true);
    expect(matchAnswer("student centre", accepted)).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(matchAnswer("shoe", ["shoe"])).toBe(true);
    expect(matchAnswer("Shoe", ["shoe"])).toBe(false);
    expect(matchAnswer("SHOE", ["shoe"])).toBe(false);
    expect(matchAnswer("London", ["London"])).toBe(true);
    expect(matchAnswer("london", ["London"])).toBe(false);
  });

  it("returns false for empty or non-matching answers", () => {
    expect(matchAnswer("", ["london"])).toBe(false);
    expect(matchAnswer("   ", ["london"])).toBe(false);
    expect(matchAnswer("paris", ["london"])).toBe(false);
  });
});
