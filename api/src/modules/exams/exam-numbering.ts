import type { SkillType } from "../questions/question.model.js";

/**
 * Canonical question numbering for IELTS exams.
 *
 * Question numbers are *display data*: Listening restarts at 1, Reading
 * restarts at 1, and every section/group flows on from the previous one within
 * the same skill. The builder lets teachers add questions in any order, paste
 * completion templates whose `[X]` blanks are local to a group, or insert bank
 * groups, so persisted numbers can end up duplicated or out of order. This
 * module is the single place that turns any section tree into canonical
 * numbers, and rewrites completion-template tokens so `[X]` still points at the
 * same question after renumbering.
 */

export interface NumberableQuestion {
  questionNumber?: number | null;
}

export interface NumberableQuestionGroup {
  config?: Record<string, unknown> | null;
  questions?: NumberableQuestion[] | null;
}

export interface NumberableSection {
  skill: SkillType;
  questionGroups?: NumberableQuestionGroup[] | null;
}

const SKILLS: SkillType[] = ["listening", "reading", "writing"];

/** Matches `[12]`, `[q12]`, `{{12}}` and `{{q12}}`. */
const TEMPLATE_TOKEN_RE =
  /(\{\{\s*(q)?(\d+)\s*\}\}|\[\s*(q)?(\d+)\s*\])/gi;

/**
 * Rewrite template blank tokens using an old → new question-number map.
 * Unknown numbers and non-blank text are left untouched.
 */
export function rewriteTemplateNumbers(
  template: string,
  remap: ReadonlyMap<number, number>
): string {
  if (!template || remap.size === 0) return template;

  return template.replace(
    TEMPLATE_TOKEN_RE,
    (match, _all, braceQ, braceNumber, bracketQ, bracketNumber) => {
      const oldNumber = Number(braceNumber ?? bracketNumber);
      const newNumber = remap.get(oldNumber);
      if (newNumber === undefined) return match;

      if (match.startsWith("{{")) {
        return `{{${braceQ ?? ""}${newNumber}}}`;
      }
      return `[${bracketQ ?? ""}${newNumber}]`;
    }
  );
}

/** Distinct blank numbers referenced by a completion template, ascending. */
export function extractTemplateNumbers(template: string): number[] {
  if (!template) return [];
  const numbers = Array.from(template.matchAll(TEMPLATE_TOKEN_RE))
    .map((match) => Number(match[3] ?? match[5]))
    .filter((number) => Number.isFinite(number) && number > 0);
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

/**
 * Align a completion template with the group's questions.
 *
 * Exact old → new mapping wins (it preserves intentionally reordered blanks).
 * When the template still uses local group numbers — e.g. a bank group whose
 * questions were renumbered on insert — the k-th blank is matched with the k-th
 * question instead. Unknown numbers are left untouched.
 */
export function alignTemplateNumbers(
  template: string,
  oldNumbers: ReadonlyArray<number | null | undefined>,
  newNumbers: readonly number[]
): string {
  if (!template || newNumbers.length === 0) return template;
  const blanks = extractTemplateNumbers(template);
  if (blanks.length === 0) return template;

  const remap = new Map<number, number>();
  oldNumbers.forEach((oldNumber, index) => {
    const newNumber = newNumbers[index];
    if (
      typeof oldNumber === "number" &&
      newNumber !== undefined &&
      !remap.has(oldNumber)
    ) {
      remap.set(oldNumber, newNumber);
    }
  });

  if (
    blanks.some((number) => !remap.has(number)) &&
    blanks.length === newNumbers.length
  ) {
    return rewriteTemplateNumbers(
      template,
      new Map(blanks.map((number, index) => [number, newNumbers[index]]))
    );
  }

  return rewriteTemplateNumbers(template, remap);
}

/**
 * Renumber every question continuously per skill, in section/group/array order.
 * Completion templates are aligned with their questions even when the numbers
 * themselves are already canonical (legacy/bank groups often kept local `[1]`
 * blanks), so blanks keep pointing at the same question. Inputs are never
 * mutated.
 */
export function normalizeExamSectionNumbering<T extends NumberableSection>(
  sections: readonly T[]
): { sections: T[]; changed: boolean } {
  const counters: Record<SkillType, number> = {
    listening: 0,
    reading: 0,
    writing: 0,
  };
  let changed = false;

  const nextSections = sections.map((section) => {
    if (!SKILLS.includes(section.skill)) return section;

    let sectionChanged = false;
    const groups = (section.questionGroups ?? []).map((group) => {
      const oldNumbers = (group.questions ?? []).map(
        (question) => question.questionNumber
      );
      const newNumbers: number[] = [];
      let groupChanged = false;

      const questions = (group.questions ?? []).map((question) => {
        counters[section.skill] += 1;
        const questionNumber = counters[section.skill];
        const previousNumber = question.questionNumber;
        newNumbers.push(questionNumber);

        if (previousNumber === questionNumber) return question;
        groupChanged = true;
        return { ...question, questionNumber };
      });

      const config = group.config;
      let nextConfig = config;
      if (typeof config?.template === "string") {
        const template = alignTemplateNumbers(
          config.template,
          oldNumbers,
          newNumbers
        );
        if (template !== config.template) {
          nextConfig = { ...config, template };
          groupChanged = true;
        }
      }

      if (!groupChanged) return group;
      sectionChanged = true;
      return { ...group, config: nextConfig, questions };
    });

    if (!sectionChanged) return section;
    changed = true;
    return { ...section, questionGroups: groups };
  });

  return { sections: changed ? nextSections : [...sections], changed };
}
