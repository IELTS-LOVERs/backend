import { describe, expect, it } from "vitest";
import { csvEscape } from "./csv.js";

describe("csvEscape", () => {
  it("leaves plain text unchanged", () => {
    expect(csvEscape("Hello world")).toBe("Hello world");
    expect(csvEscape(123)).toBe("123");
  });

  it("handles null and undefined as empty string", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("escapes commas by wrapping in quotes", () => {
    expect(csvEscape("Nguyen, Van A")).toBe('"Nguyen, Van A"');
  });

  it("escapes quotes by doubling them and wrapping in quotes", () => {
    expect(csvEscape('He said "Hello"')).toBe('"He said ""Hello"""');
  });

  it("escapes newlines and carriage returns", () => {
    expect(csvEscape("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
    expect(csvEscape("Line 1\r\nLine 2")).toBe('"Line 1\r\nLine 2"');
  });

  it("prefixes formula-like text to prevent CSV injection", () => {
    expect(csvEscape("=HYPERLINK(\"http://evil\")")).toBe(
      '"\'=HYPERLINK(""http://evil"")"'
    );
    expect(csvEscape("+1+1")).toBe("'+1+1");
    expect(csvEscape("@cmd")).toBe("'@cmd");
    expect(csvEscape(-5)).toBe("-5");
  });
});
