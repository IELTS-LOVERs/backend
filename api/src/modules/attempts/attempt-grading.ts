import {
  collectMultiSelectKeys,
  gradeMultiSelectAnswer,
} from "../../common/utils/multi-select.js";
import { matchAnswer } from "../../common/utils/string-normalizer.js";
import { normalizeExamSectionNumbering } from "../exams/exam-numbering.js";
import type {
  IAttemptAnswer,
  IAttemptResultDetail,
  IAttemptScores,
} from "./attempt.model.js";
import type {
  BuiltResultSnapshot,
  ExamQuestionBuckets,
  GradableGroupQuestion,
  GradeBreakdown,
  RawExamObject,
} from "./attempt.types.js";

export function collectExamQuestionBuckets(examObj: RawExamObject): ExamQuestionBuckets {
  const listeningGrouped: GradableGroupQuestion[] = [];
  const readingGrouped: GradableGroupQuestion[] = [];
  let hasListening = false;
  let hasReading = false;
  let hasWriting = false;

  for (const section of examObj.sections ?? []) {
    if (section.skill === "listening") hasListening = true;
    else if (section.skill === "reading") hasReading = true;
    else if (section.skill === "writing") hasWriting = true;

    for (const group of section.questionGroups ?? []) {
      const groupId = group._id ? group._id.toString() : undefined;
      for (const q of group.questions ?? []) {
        const gradable: GradableGroupQuestion = {
          _id: q._id,
          questionNumber: q.questionNumber,
          acceptedAnswers: q.acceptedAnswers ?? [],
          points: q.points ?? 1,
          groupConfig: group.config ?? {},
          groupType: group.groupType,
          groupId,
        };
        if (section.skill === "listening") listeningGrouped.push(gradable);
        else if (section.skill === "reading") readingGrouped.push(gradable);
      }
    }
  }

  return { hasListening, hasReading, hasWriting, listeningGrouped, readingGrouped };
}

/** Group types where a configured word limit actually applies to the answer. */
export const WORD_LIMIT_GROUP_TYPES = new Set<string>([
  "sentence_completion",
  "note_completion",
  "table_completion",
  "summary_completion",
  "summary_completion_options",
  "form_completion",
  "flow_chart_completion",
  "short_answer",
]);

/** FIX-11: only completion/short-answer groups enforce `config.maxWords`. */
export function shouldEnforceWordLimit(groupType: string): boolean {
  return WORD_LIMIT_GROUP_TYPES.has(groupType);
}

/** Check word count for completion-type answers */
export function checkWordLimit(answer: string, config: Record<string, unknown>): boolean {
  const maxWords = config.maxWords as number | undefined;
  if (!maxWords) return true;
  const wordCount = answer.trim().split(/\s+/).filter(Boolean).length;
  return wordCount <= maxWords;
}

/** Grade questions and return raw points + correct/wrong/blank counts. */
export function gradeGroupedQuestionsDetailed(
  answers: Pick<IAttemptAnswer, "questionId" | "value">[],
  questions: GradableGroupQuestion[]
): GradeBreakdown {
  const answerByQuestionId = new Map(
    answers.map((answer) => [answer.questionId.toString(), answer.value])
  );

  const multiSelectGroups = new Map<string, GradableGroupQuestion[]>();
  for (const question of questions) {
    if (question.groupType !== "multiple_choice_multiple" || !question.groupId) {
      continue;
    }
    const list = multiSelectGroups.get(question.groupId) ?? [];
    list.push(question);
    multiSelectGroups.set(question.groupId, list);
  }
  const multiSelectKeys = new Map<string, Set<string>>();
  const multiSelectSeen = new Map<string, Set<string>>();

  let rawScore = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let blankCount = 0;

  for (const question of questions) {
    const value = answerByQuestionId.get(question._id.toString());

    if (value === undefined || value.trim() === "") {
      blankCount += 1;
      continue;
    }

    if (
      shouldEnforceWordLimit(question.groupType) &&
      !checkWordLimit(value, question.groupConfig)
    ) {
      wrongCount += 1;
      continue;
    }

    const groupId = question.groupId;
    const isMultiSelect = Boolean(groupId && multiSelectGroups.has(groupId));
    let isCorrect: boolean;

    if (isMultiSelect) {
      let keys = multiSelectKeys.get(groupId!);
      if (!keys) {
        keys = collectMultiSelectKeys(multiSelectGroups.get(groupId!));
        multiSelectKeys.set(groupId!, keys);
      }
      const seen = multiSelectSeen.get(groupId!) ?? new Set<string>();
      multiSelectSeen.set(groupId!, seen);
      isCorrect = gradeMultiSelectAnswer(value, keys, seen);
    } else {
      isCorrect = matchAnswer(value, question.acceptedAnswers);
    }

    if (isCorrect) {
      rawScore += question.points;
      correctCount += 1;
    } else {
      wrongCount += 1;
    }
  }

  return { rawScore, correctCount, wrongCount, blankCount };
}

/** Grade questions from embedded question groups (with word-limit enforcement). */
export function gradeGroupedQuestions(
  answers: Pick<IAttemptAnswer, "questionId" | "value">[],
  questions: GradableGroupQuestion[]
): number {
  return gradeGroupedQuestionsDetailed(answers, questions).rawScore;
}

/**
 * Build the immutable result snapshot for an attempt.
 *
 * Numbering is normalized first so the snapshot matches what the candidate saw
 * (canonical per-skill numbering). `questionCount`/`totalPoints` are recomputed
 * here because the exam may have changed between start and submit.
 */
export function buildResultDetails(
  examObj: RawExamObject,
  answers: Pick<IAttemptAnswer, "questionId" | "value">[]
): BuiltResultSnapshot {
  const sections = normalizeExamSectionNumbering(examObj.sections ?? []).sections;
  const answerByQuestionId = new Map(
    answers.map((answer) => [answer.questionId.toString(), answer.value])
  );
  const details: IAttemptResultDetail[] = [];
  let questionCount = 0;
  let totalPoints = 0;

  for (const section of sections) {
    for (const group of section.questionGroups ?? []) {
      const isMultiSelectGroup = group.groupType === "multiple_choice_multiple";
      const multiSelectKeys = isMultiSelectGroup
        ? collectMultiSelectKeys(group.questions ?? [])
        : null;
      const multiSelectSeen = new Set<string>();

      for (const question of group.questions ?? []) {
        const studentAnswer =
          answerByQuestionId.get(question._id.toString()) ?? null;
        const acceptedAnswers = question.acceptedAnswers ?? [];

        const isWriting = section.skill === "writing";

        let isCorrect = false;
        if (!isWriting && studentAnswer !== null) {
          const withinWordLimit =
            !shouldEnforceWordLimit(group.groupType) ||
            checkWordLimit(studentAnswer, group.config ?? {});
          isCorrect =
            multiSelectKeys && multiSelectKeys.size > 0
              ? gradeMultiSelectAnswer(
                  studentAnswer,
                  multiSelectKeys,
                  multiSelectSeen
                )
              : withinWordLimit && matchAnswer(studentAnswer, acceptedAnswers);
        }

        if (!isWriting) {
          questionCount += 1;
          totalPoints += question.points ?? 1;
        }

        details.push({
          questionId: question._id,
          questionNumber: question.questionNumber,
          groupType: group.groupType,
          skill: section.skill,
          studentAnswer,
          acceptedAnswers,
          isCorrect,
          explanation: question.explanation ?? null,
          prompt: question.prompt ?? "",
          points: question.points ?? 1,
        });
      }
    }
  }

  return { details, questionCount, totalPoints };
}

export function serializeScores(scores: IAttemptScores): IAttemptScores {
  return {
    listeningRaw: scores.listeningRaw,
    listeningBand: scores.listeningBand,
    readingRaw: scores.readingRaw,
    readingBand: scores.readingBand,
    writingTask1Band: scores.writingTask1Band,
    writingTask2Band: scores.writingTask2Band,
    writingBand: scores.writingBand,
    overallBand: scores.overallBand,
  };
}
