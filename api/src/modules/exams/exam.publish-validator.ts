import { BadRequestError } from "../../common/errors/AppError.js";
import { logger } from "../../common/utils/logger.js";
import { shouldEnforceWordLimit } from "../attempts/attempt.service.js";
import { normalizeExamSectionNumbering } from "./exam-numbering.js";
import { sectionUsesGroups } from "./exam.mapper.js";
import type { IExam } from "./exam.model.js";

/** Count total questions across all sections. */
export function countExamQuestions(exam: Pick<IExam, "sections">): number {
  let count = 0;
  for (const section of exam.sections ?? []) {
    for (const group of section.questionGroups ?? []) {
      count += (group.questions ?? []).length;
    }
  }
  return count;
}

export function validateExamReadyForPublish(exam: IExam): void {
  // Heal legacy drafts on publish: numbering is part of the candidate contract.
  const normalized = normalizeExamSectionNumbering(exam.sections);
  if (normalized.changed) exam.sections = normalized.sections;

  if (exam.sections.length === 0 || countExamQuestions(exam) === 0) {
    throw new BadRequestError(
      "EXAM_EMPTY",
      "Đề thi phải có ít nhất một câu hỏi để xuất bản."
    );
  }

  if (exam.durationMinutes !== undefined && (exam.durationMinutes < 10 || exam.durationMinutes > 180)) {
    throw new BadRequestError(
      "EXAM_INVALID_DURATION",
      "Thời lượng đề thi phải từ 10 đến 180 phút."
    );
  }

  if (exam.openAt && exam.closeAt && exam.openAt >= exam.closeAt) {
    throw new BadRequestError(
      "EXAM_INVALID_DATES",
      "Thời gian mở đề thi phải trước thời gian đóng đề thi."
    );
  }

  // Specific validation for practice: allow single or multiple parts
  if (exam.kind === "practice") {
    if (!exam.sections || exam.sections.length === 0) {
      throw new BadRequestError(
        "PRACTICE_MUST_HAVE_SECTIONS",
        "Bài luyện tập phải có ít nhất 1 phần thi (section)."
      );
    }

    const curriculumSection = exam.sections[0];
    if (
      exam.curriculum?.part !== undefined &&
      exam.sections.length === 1 &&
      curriculumSection.part !== undefined &&
      curriculumSection.skill !== "writing" &&
      exam.curriculum.part !== curriculumSection.part
    ) {
      throw new BadRequestError(
        "CURRICULUM_PART_MISMATCH",
        `Phần curriculum.part (${exam.curriculum.part}) phải khớp với phần thi (${curriculumSection.part}).`
      );
    }
  }

  if (exam.kind === "practice") {
    exam.scoringMode = "raw";
    exam.bandConversion = undefined;
  }

  for (const section of exam.sections) {
    if (sectionUsesGroups(section)) {
      for (const group of section.questionGroups) {
        if (group.questions.length === 0) {
          throw new BadRequestError(
            "EXAM_GROUP_EMPTY",
            `Nhóm câu hỏi trong phần ${section.title || section.part} không được để trống.`
          );
        }
        if (section.skill !== "writing") {
          for (const q of group.questions) {
            if (!q.acceptedAnswers || q.acceptedAnswers.length === 0) {
              throw new BadRequestError(
                "EXAM_QUESTION_MISSING_ANSWER",
                `Câu hỏi số ${q.questionNumber} chưa có đáp án đúng.`
              );
            }
          }
        }

        const configuredMaxWords = (group.config as { maxWords?: unknown } | undefined)?.maxWords;
        if (
          typeof configuredMaxWords === "number" &&
          !shouldEnforceWordLimit(group.groupType)
        ) {
          logger.warn("exam.publish_word_limit_ignored", {
            examId: exam._id.toString(),
            groupType: group.groupType,
            maxWords: configuredMaxWords,
          });
        }
      }
    }
  }

  // Listening/reading point check
  for (const section of exam.sections) {
    if (section.skill === "writing") continue;

    let sectionPoints = 0;
    for (const group of section.questionGroups) {
      for (const q of group.questions) {
        sectionPoints += q.points ?? 1;
      }
    }

    if (sectionPoints > 40) {
      throw new BadRequestError(
        "EXAM_POINTS_EXCEEDS_40",
        `Phần ${section.title || section.part} có tổng điểm ${sectionPoints}, vượt quá 40 điểm của một kỹ năng IELTS.`
      );
    }

    if (sectionPoints > 0 && sectionPoints !== 40 && exam.kind !== "practice") {
      logger.warn("exam.publish_points_mismatch", {
        examId: exam._id.toString(),
        skill: section.skill,
        part: section.part,
        sectionPoints,
      });
    }
  }
}
