import { describe, expect, it } from "vitest";
import { matchAnswer, normalizeAnswer } from "./string-normalizer.js";

describe("normalizeAnswer", () => {
  it("trims, lowercases and collapses whitespace", () => {
    expect(normalizeAnswer(" London  ")).toBe("london");
    expect(normalizeAnswer("New   York")).toBe("new york");
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
  it("matches any accepted answer after normalization", () => {
    const accepted = ["student centre", "student center"];
    expect(matchAnswer(" Student Center ", accepted)).toBe(true);
    expect(matchAnswer("student centre", accepted)).toBe(true);
  });

  it("returns false for empty or non-matching answers", () => {
    expect(matchAnswer("", ["london"])).toBe(false);
    expect(matchAnswer("   ", ["london"])).toBe(false);
    expect(matchAnswer("paris", ["london"])).toBe(false);
  });
});
