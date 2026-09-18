/**
 * Normalizes a free-text answer before comparison for auto-grading.
 *
 * Steps:
 * 1. Trim leading/trailing whitespace.
 * 2. Lowercase.
 * 3. Normalize typographic single/double quotes to ASCII quotes.
 * 4. Collapse consecutive whitespace (including newlines) into a single space.
 * 5. Strip punctuation that does not affect meaning (keep letters, digits,
 *    spaces, apostrophes, hyphens and slashes).
 */
export function normalizeAnswer(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, "")
    .replace(/[^\p{L}\p{N}\s'/.-]+/gu, "")
    .trim();
}

export function matchAnswer(studentAnswer: string, acceptedAnswers: string[]): boolean {
  if (!studentAnswer) return false;

  const normalizedStudentAnswer = normalizeAnswer(studentAnswer);
  if (!normalizedStudentAnswer) return false;

  return acceptedAnswers.some(
    (accepted) => normalizeAnswer(accepted) === normalizedStudentAnswer
  );
}
