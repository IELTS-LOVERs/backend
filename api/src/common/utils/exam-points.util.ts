/** Structural shape used by `countExamPoints` (hydrated or lean documents). */
export interface ExamPointsSource {
  sections?: Array<{
    questionGroups?: Array<{
      questions?: Array<{ points?: number }>;
    }>;
  }> | null;
}

/** Count total points across all questions (including weights). */
export function countExamPoints(exam?: ExamPointsSource | null): number {
  let count = 0;

  for (const section of exam?.sections ?? []) {
    for (const group of section.questionGroups ?? []) {
      for (const question of group.questions ?? []) {
        count += question.points ?? 1;
      }
    }
  }

  return count;
}
