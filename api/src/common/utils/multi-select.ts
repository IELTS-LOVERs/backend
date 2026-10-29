import { normalizeAnswer } from "./string-normalizer.js";

/**
 * Grading helpers for "Choose TWO letters" style groups.
 *
 * Such a group is authored as N questions (one answer box per letter) that
 * share a single key: `Q9 → A`, `Q10 → E`. Candidates may put the letters in
 * either box, and each correct letter is worth one point, so grading has to
 * look at the whole group instead of a single question.
 */

/** Union of the accepted letters of every question in the group. */
export function collectMultiSelectKeys(
  questions: Array<{ acceptedAnswers?: string[] | null }> | undefined
): Set<string> {
  const keys = new Set<string>();
  for (const question of questions ?? []) {
    for (const answer of question.acceptedAnswers ?? []) {
      const normalized = normalizeAnswer(answer);
      if (normalized) keys.add(normalized);
    }
  }
  return keys;
}

/**
 * Grade one answer box of a multi-select group.
 *
 * - Order-insensitive: the letter only has to appear in the group key set.
 * - Partial credit: each correct letter scores the points of its own question.
 * - `seen` is shared by every question of the group, so the same letter cannot
 *   be claimed twice (which would otherwise award an extra point).
 * - Legacy groups stored both letters in one box ("A, E"); a comma separated
 *   value is split and every letter must be part of the key set.
 */
export function gradeMultiSelectAnswer(
  value: string,
  keys: Set<string>,
  seen?: Set<string>
): boolean {
  if (keys.size === 0) return false;

  const letters = value
    .split(",")
    .map((part) => normalizeAnswer(part))
    .filter(Boolean);
  if (letters.length === 0) return false;

  let allCorrect = true;
  for (const letter of letters) {
    const duplicate = seen?.has(letter) ?? false;
    seen?.add(letter);
    if (duplicate || !keys.has(letter)) allCorrect = false;
  }
  return allCorrect;
}
