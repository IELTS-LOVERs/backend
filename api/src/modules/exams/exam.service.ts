import { countExamPoints } from "../../common/utils/exam-points.util.js";
import { assertOwnership } from "../../common/utils/ownership.util.js";
import { extractMediaId } from "../../common/utils/media.util.js";
import { escapeRegExp } from "../../common/utils/escape-regexp.js";
import {
  defaultThresholdsForSkill,
  normalizeBandConversion,
} from "../../common/utils/band-conversion.js";
import mongoose, { type Types } from "mongoose";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors/AppError.js";
import { logger } from "../../common/utils/logger.js";
import {
  buildCandidateExam,
  examMediaPresignTtl,
  presignMediaMap,
  toCandidateMediaItem,
  type CandidateMediaItem,
} from "../attempts/attempt.service.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { AssignmentModel } from "../assignments/assignment.model.js";
import { ExamEventModel } from "../anti-cheat/exam-event.model.js";
import { WritingReviewModel } from "../grading/writing-review.model.js";
import { normalizeExamSectionNumbering } from "./exam-numbering.js";
import {
  ExamModel,
  type ExamStatus,
  type ExamScoringMode,
  type IExam,
  type IExamCurriculum,
  type IExamPostSubmissionResources,
} from "./exam.model.js";
import { canStudentAccessExam, getAssignedExamIds } from "./exam.access.js";
import type {
  CreateExamBody,
  UpdateExamBody,
  UpdateExamCurriculumBody,
  UpdateExamMetadataBody,
  UpdateExamResourcesBody,
} from "./exam.validation.js";

export { canStudentAccessExam, getAssignedExamIds };

export * from "./exam.types.js";
export * from "./exam.mapper.js";
export * from "./exam.publish-validator.js";

import {
  EXAM_LIST_SORTS,
  type ExamDetail,
  type ExamFilter,
  type ExamListItem,
  type ExamSectionDetail,
  type ExamSummary,
  type ListExamsFilters,
  type StudentExamDetail,
} from "./exam.types.js";

import {
  collectExamSkills,
  compareExamTitles,
  buildCollectionFilter,
  examContentSignature,
  examKindFilter,
  getDefaultSectionTitle,
  mapBandConversionInput,
  mapCurriculumInput,
  mapResourcesInput,
  mapSections,
  normalizeBannerUrl,
  sameBandConversion,
  serializeQuestionGroup,
  toStoredBannerUrl,
} from "./exam.mapper.js";

import {
  validateExamReadyForPublish,
} from "./exam.publish-validator.js";



async function findOwnedExam(id: string, userId: string, role: string): Promise<IExam> {
  const exam = await ExamModel.findById(id);

  if (!exam) {
    throw new NotFoundError("Đề thi không tồn tại.");
  }

  assertOwnership(exam, userId, role);
  return exam;
}


export async function create(data: CreateExamBody, userId: string): Promise<ExamSummary> {
  const kind = data.kind ?? data.type ?? "mock";
  const scoringMode: ExamScoringMode =
    kind === "practice" ? "raw" : data.scoringMode ?? "band";
  const bandConversion =
    kind === "mock" && scoringMode === "band"
      ? mapBandConversionInput(data.bandConversion) ?? normalizeBandConversion()
      : undefined;

  const exam = await ExamModel.create({
    title: data.title,
    description: data.description ?? undefined,
    bannerUrl: toStoredBannerUrl(data.bannerUrl),
    kind,
    scoringMode,
    bandConversion,
    disableTextSelection: data.disableTextSelection ?? false,
    curriculum: mapCurriculumInput(data.curriculum),
    postSubmissionResources: mapResourcesInput(data.postSubmissionResources),
    durationMinutes: data.durationMinutes,
    sections: mapSections(data.sections),
    status: "draft",
    openAt: data.openAt ? new Date(data.openAt) : undefined,
    closeAt: data.closeAt ? new Date(data.closeAt) : undefined,
    createdBy: new mongoose.Types.ObjectId(userId),
  });

  return {
    id: exam._id.toString(),
    title: exam.title,
    durationMinutes: exam.durationMinutes,
    status: exam.status,
    kind: exam.kind,
    scoringMode: exam.scoringMode,
    bandConversion: exam.bandConversion,
    disableTextSelection: exam.disableTextSelection ?? false,
    curriculum: exam.curriculum,
    sectionsCount: exam.sections.length,
    type: exam.kind,
  };
}

export async function list(
  userId: string,
  role: string,
  filters: ListExamsFilters
): Promise<{
  exams: ExamListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  const {
    status,
    kind,
    type,
    skill,
    collectionName,
    search,
    sort,
    page,
    limit,
  } = filters;
  const requestedKind = kind ?? type;
  const query: ExamFilter = {};

  if (role === "student") {
    query.status = "published";
    query._id = { $in: await getAssignedExamIds(userId) };
    if (requestedKind) query.kind = examKindFilter(requestedKind);
  } else {
    if (role !== "admin") query.createdBy = userId;
    if (status) query.status = status;
    if (requestedKind) query.kind = examKindFilter(requestedKind);
  }

  if (skill) query["sections.skill"] = skill;

  // `collectionName` and `search` each need their own `$or`; keep them under
  // `$and` so one never overwrites the other.
  const and: Array<Record<string, unknown>> = [];
  if (collectionName?.trim()) {
    and.push(buildCollectionFilter(collectionName));
  }
  if (search?.trim()) {
    const matcher = new RegExp(escapeRegExp(search.trim()), "i");
    and.push({
      $or: [{ title: matcher }, { "curriculum.collectionName": matcher }],
    });
  }
  if (and.length > 0) query.$and = and;

  const sortSpec = EXAM_LIST_SORTS[sort ?? "date_desc"];
  const examsQuery = ExamModel.find(query);

  // `numericOrdering` makes Mongo sort "CAM 8" before "CAM 9"/"CAM 10" across
  // the whole result set (not just the current page).
  if (
    (sort === "title_asc" || sort === "title_desc" || sort === "collection_asc") &&
    typeof examsQuery.collation === "function"
  ) {
    examsQuery.collation({ locale: "en", numericOrdering: true });
  }

  const [exams, total] = await Promise.all([
    examsQuery
      .sort(sortSpec)
      .skip((page - 1) * limit)
      .limit(limit),
    ExamModel.countDocuments(query),
  ]);

  // Mongo compares titles lexicographically; re-sort the page naturally for the
  // alphabet modes so CAM 8 comes before CAM 9/CAM 10.
  if (sort === "title_asc" || sort === "title_desc") {
    const direction = sort === "title_asc" ? 1 : -1;
    exams.sort((a, b) => direction * compareExamTitles(a.title, b.title));
  }

  // Teacher/admin views need to know whether each exam can be deleted or edited.
  // One extra pair of queries per page (never per row), skipped for students.
  const attemptStats = new Map<string, { total: number; active: number }>();
  const assignedIds = new Set<string>();

  if (role !== "student" && exams.length > 0) {
    const examIds = exams.map((exam) => exam._id);
    const [attemptRows, assigned] = await Promise.all([
      AttemptModel.aggregate<{
        _id: Types.ObjectId;
        total: number;
        active: number;
      }>([
        { $match: { examId: { $in: examIds } } },
        {
          $group: {
            _id: "$examId",
            total: { $sum: 1 },
            active: {
              $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] },
            },
          },
        },
      ]),
      AssignmentModel.distinct("examId", { examId: { $in: examIds } }),
    ]);
    for (const row of attemptRows) {
      attemptStats.set(row._id.toString(), {
        total: row.total,
        active: row.active,
      });
    }
    assigned.forEach((id) => assignedIds.add(String(id)));
  }

  return {
    exams: exams.map((exam) => {
      const id = exam._id.toString();
      return {
        id,
        title: exam.title,
        durationMinutes: exam.durationMinutes,
        status: exam.status,
        kind: exam.kind ?? "mock",
        scoringMode:
          (exam.kind ?? "mock") === "practice"
            ? "raw"
            : exam.scoringMode ?? "band",
        bandConversion: exam.kind === "practice" ? undefined : exam.bandConversion,
        curriculum: exam.curriculum,
        sectionsCount: exam.sections?.length ?? 0,
        skills: collectExamSkills(exam.sections),
        createdAt: exam.createdAt,
        type: exam.kind ?? "mock",
        ...(role !== "student"
          ? {
              hasAttempts: attemptStats.has(id),
              hasAssignments: assignedIds.has(id),
              attemptsCount: attemptStats.get(id)?.total ?? 0,
              activeAttemptsCount: attemptStats.get(id)?.active ?? 0,
            }
          : {}),
        contentRevision: exam.contentRevision ?? 0,
      };
    }),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getById(
  id: string,
  userId?: string,
  role?: string
): Promise<ExamDetail | StudentExamDetail> {
  const exam = await ExamModel.findById(id).populate([
    { path: "sections.mediaIds", model: "Media" },
  ]);

  if (!exam) {
    throw new NotFoundError("Đề thi không tồn tại.");
  }

  const mediaUrlMap = await presignMediaMap(
    exam,
    examMediaPresignTtl(exam.durationMinutes)
  );

  if (role === "student") {
    const allowed = await canStudentAccessExam(userId!, exam);
    if (!allowed) {
      throw new ForbiddenError(
        "FORBIDDEN",
        "Học sinh không có quyền truy cập đề thi này."
      );
    }

    return {
      ...buildCandidateExam(exam, mediaUrlMap),
      durationMinutes: exam.durationMinutes,
      status: exam.status,
      kind: exam.kind ?? "mock",
      scoringMode:
        (exam.kind ?? "mock") === "practice"
          ? "raw"
          : exam.scoringMode ?? "band",
      bandConversion: exam.kind === "practice" ? undefined : exam.bandConversion,
      curriculum: exam.curriculum,
      contentRevision: exam.contentRevision ?? 0,
      type: exam.kind ?? "mock",
    };
  }

  if (userId && role && role !== "admin" && exam.createdBy?.toString() !== userId) {
    throw new ForbiddenError("FORBIDDEN", "Người dùng không đủ quyền thực hiện hành động.");
  }

  const [attemptsCount, activeAttemptsCount, hasAssignments] = await Promise.all([
    AttemptModel.countDocuments({ examId: exam._id }),
    AttemptModel.countDocuments({ examId: exam._id, status: "in_progress" }),
    AssignmentModel.exists({ examId: exam._id }),
  ]);

  const sections: ExamSectionDetail[] = exam.sections.map((section) => {
    const sectionMediaIds = (section.mediaIds ?? []).map(extractMediaId).filter(Boolean);
    const sectionMedia = (section.mediaIds ?? [])
      .map((item) => toCandidateMediaItem(item, mediaUrlMap))
      .filter((media): media is CandidateMediaItem => media !== null);

    return {
      id: section._id?.toString() ?? "",
      skill: section.skill,
      part: section.part,
      title: section.title?.trim() || getDefaultSectionTitle(section.skill, section.part),
      instructions: section.instructions ?? null,
      instructionsDoc: section.instructionsDoc ?? null,
      passageText: section.passageText ?? null,
      passageDoc: section.passageDoc ?? null,
      transcript: section.transcript ?? null,
      mediaIds: sectionMediaIds,
      media: sectionMedia,
      questionGroups: (section.questionGroups ?? []).map((group) =>
        serializeQuestionGroup(group, mediaUrlMap)
      ),
    };
  });
  // Legacy drafts may have duplicated/stale numbers. The editor displays the
  // canonical sequence and writes it back on the next autosave.
  const normalizedSections = normalizeExamSectionNumbering(sections).sections;

  return {
    id: exam._id.toString(),
    title: exam.title,
    description: exam.description ?? null,
    bannerUrl: normalizeBannerUrl(exam.bannerUrl),
    durationMinutes: exam.durationMinutes,
    status: exam.status,
    kind: exam.kind ?? "mock",
    scoringMode:
      (exam.kind ?? "mock") === "practice"
        ? "raw"
        : exam.scoringMode ?? "band",
    bandConversion: exam.kind === "practice" ? undefined : exam.bandConversion,
    disableTextSelection: exam.disableTextSelection ?? false,
    bandConversionDefaults: {
      listening: defaultThresholdsForSkill("listening"),
      readingAcademic: defaultThresholdsForSkill("reading", "academic"),
      readingGeneral: defaultThresholdsForSkill("reading", "general"),
    },
    curriculum: exam.curriculum,
    postSubmissionResources: exam.postSubmissionResources,
    openAt: exam.openAt ?? null,
    closeAt: exam.closeAt ?? null,
    hasAttempts: attemptsCount > 0,
    hasAssignments: Boolean(hasAssignments),
    attemptsCount,
    activeAttemptsCount,
    contentRevision: exam.contentRevision ?? 0,
    sections: normalizedSections,
    type: exam.kind ?? "mock",
  };
}

export async function update(
  id: string,
  data: UpdateExamBody,
  userId: string,
  role: string
): Promise<void> {
  const exam = await findOwnedExam(id, userId, role);
  const previousContentSignature = examContentSignature(exam.sections);

  const newKind = data.kind ?? data.type;
  if (newKind !== undefined && newKind !== exam.kind) {
    const [hasAssignment, hasAttempt] = await Promise.all([
      AssignmentModel.exists({ examId: exam._id }),
      AttemptModel.exists({ examId: exam._id }),
    ]);
    if (hasAssignment || hasAttempt) {
      throw new BadRequestError(
        "EXAM_KIND_IMMUTABLE",
        "Không thể thay đổi loại đề thi sau khi đã có bài tập hoặc lượt làm bài."
      );
    }
    exam.kind = newKind;
  }
  if (data.title !== undefined) exam.title = data.title;
  if (data.description !== undefined) exam.description = data.description ?? undefined;
  if (data.bannerUrl !== undefined) exam.bannerUrl = toStoredBannerUrl(data.bannerUrl);
  if (data.disableTextSelection !== undefined) {
    exam.disableTextSelection = data.disableTextSelection;
  }
  if (
    data.scoringMode !== undefined ||
    data.bandConversion !== undefined ||
    (newKind !== undefined && newKind !== exam.kind)
  ) {
    const nextKind = newKind ?? exam.kind;
    const nextScoringMode: ExamScoringMode =
      nextKind === "practice" ? "raw" : data.scoringMode ?? exam.scoringMode ?? "band";
    const nextBandConversion =
      nextKind === "mock" && nextScoringMode === "band"
        ? data.bandConversion !== undefined
          ? mapBandConversionInput(data.bandConversion) ?? normalizeBandConversion()
          : normalizeBandConversion(exam.bandConversion)
        : undefined;
    const scoringConfigChanged =
      nextScoringMode !== exam.scoringMode ||
      !sameBandConversion(nextBandConversion, exam.bandConversion);

    if (scoringConfigChanged) {
      const hasAttempt = await AttemptModel.exists({ examId: exam._id });
      if (hasAttempt) {
        throw new BadRequestError(
          "EXAM_SCORING_MODE_IMMUTABLE",
          "Không thể thay đổi cách chấm điểm sau khi đã có lượt làm bài."
        );
      }
    }

    exam.scoringMode = nextScoringMode;
    exam.bandConversion = nextBandConversion;
  }
  if (data.curriculum !== undefined) exam.curriculum = mapCurriculumInput(data.curriculum);
  if (data.postSubmissionResources !== undefined) exam.postSubmissionResources = mapResourcesInput(data.postSubmissionResources);
  if (data.durationMinutes !== undefined) exam.durationMinutes = data.durationMinutes;
  if (data.sections !== undefined) exam.sections = mapSections(data.sections);
  if (data.openAt !== undefined) exam.openAt = data.openAt ? new Date(data.openAt) : undefined;
  if (data.closeAt !== undefined) exam.closeAt = data.closeAt ? new Date(data.closeAt) : undefined;

  // Only real content changes (questions/answers/passages/media/order) bump the
  // revision. Metadata edits (title, dates, banner…) must not disturb students
  // who are currently taking the exam.
  const contentChanged =
    examContentSignature(exam.sections) !== previousContentSignature;

  if (contentChanged) {
    if (exam.status !== "draft") {
      // Published/closed exams are live: the new content must still be a valid
      // exam, otherwise the old content keeps serving students.
      validateExamReadyForPublish(exam);
    }
    exam.contentRevision = (exam.contentRevision ?? 0) + 1;
  }

  await exam.save();

  if (contentChanged) {
    logger.info("exam.content_updated", {
      examId: exam._id.toString(),
      status: exam.status,
      contentRevision: exam.contentRevision,
    });
  }
}

/** Allow editing metadata (title, description, open/close times) on published exams */
export async function updateMetadata(
  id: string,
  data: UpdateExamMetadataBody,
  userId: string,
  role: string
): Promise<void> {
  const exam = await findOwnedExam(id, userId, role);

  const newKind = data.kind ?? data.type;
  if (newKind !== undefined && newKind !== exam.kind) {
    if (exam.status !== "draft") {
      throw new BadRequestError(
        "EXAM_KIND_IMMUTABLE",
        "Không thể thay đổi loại đề thi sau khi đã xuất bản."
      );
    }
    const [hasAssignment, hasAttempt] = await Promise.all([
      AssignmentModel.exists({ examId: exam._id }),
      AttemptModel.exists({ examId: exam._id }),
    ]);
    if (hasAssignment || hasAttempt) {
      throw new BadRequestError(
        "EXAM_KIND_IMMUTABLE",
        "Không thể thay đổi loại đề thi sau khi đã có bài tập hoặc lượt làm bài."
      );
    }
    exam.kind = newKind;
  }
  if (data.title !== undefined) exam.title = data.title;
  if (data.description !== undefined) exam.description = data.description ?? undefined;
  if (data.bannerUrl !== undefined) exam.bannerUrl = toStoredBannerUrl(data.bannerUrl);
  if (data.disableTextSelection !== undefined) {
    exam.disableTextSelection = data.disableTextSelection;
  }
  if (
    data.scoringMode !== undefined ||
    data.bandConversion !== undefined ||
    (newKind !== undefined && newKind !== exam.kind)
  ) {
    const nextKind = newKind ?? exam.kind;
    const nextScoringMode: ExamScoringMode =
      nextKind === "practice" ? "raw" : data.scoringMode ?? exam.scoringMode ?? "band";
    const nextBandConversion =
      nextKind === "mock" && nextScoringMode === "band"
        ? data.bandConversion !== undefined
          ? mapBandConversionInput(data.bandConversion) ?? normalizeBandConversion()
          : normalizeBandConversion(exam.bandConversion)
        : undefined;
    const scoringConfigChanged =
      nextScoringMode !== exam.scoringMode ||
      !sameBandConversion(nextBandConversion, exam.bandConversion);

    if (scoringConfigChanged) {
      const hasAttempt = await AttemptModel.exists({ examId: exam._id });
      if (hasAttempt) {
        throw new BadRequestError(
          "EXAM_SCORING_MODE_IMMUTABLE",
          "Không thể thay đổi cách chấm điểm sau khi đã có lượt làm bài."
        );
      }
    }

    exam.scoringMode = nextScoringMode;
    exam.bandConversion = nextBandConversion;
  }
  if (data.curriculum !== undefined) exam.curriculum = mapCurriculumInput(data.curriculum);
  if (data.postSubmissionResources !== undefined) exam.postSubmissionResources = mapResourcesInput(data.postSubmissionResources);
  if (data.openAt !== undefined) exam.openAt = data.openAt ? new Date(data.openAt) : undefined;
  if (data.closeAt !== undefined) exam.closeAt = data.closeAt ? new Date(data.closeAt) : undefined;

  await exam.save();
}

/** Allow updating postSubmissionResources even on published/closed exams */
export async function updateResources(
  id: string,
  data: UpdateExamResourcesBody,
  userId: string,
  role: string
): Promise<IExamPostSubmissionResources | null> {
  const exam = await findOwnedExam(id, userId, role);

  const currentResources = exam.postSubmissionResources ?? {};

  const updatedResources: IExamPostSubmissionResources = {
    solutionVideoUrl: data.solutionVideoUrl !== undefined ? (data.solutionVideoUrl ?? undefined) : currentResources.solutionVideoUrl,
    solutionDocumentUrl: data.solutionDocumentUrl !== undefined ? (data.solutionDocumentUrl ?? undefined) : currentResources.solutionDocumentUrl,
    solutionNotes: data.solutionNotes !== undefined ? (data.solutionNotes ?? undefined) : currentResources.solutionNotes,
    vocabularyItems: data.vocabularyItems !== undefined ? (data.vocabularyItems ? data.vocabularyItems.map((v) => ({
      word: v.word,
      phonetic: v.phonetic ?? undefined,
      meaning: v.meaning,
      contextSentence: v.contextSentence ?? undefined,
    })) : []) : currentResources.vocabularyItems,
  };

  exam.postSubmissionResources = updatedResources;
  await exam.save();

  return exam.postSubmissionResources ?? null;
}

/** Allow updating curriculum metadata */
export async function updateCurriculum(
  id: string,
  data: UpdateExamCurriculumBody,
  userId: string,
  role: string
): Promise<IExamCurriculum | null> {
  const exam = await findOwnedExam(id, userId, role);

  exam.curriculum = mapCurriculumInput(data);
  await exam.save();

  return exam.curriculum ?? null;
}

export interface RemoveExamOptions {
  /**
   * Admin-only hard delete. Removes attempts (including ones still in
   * progress), writing reviews and anti-cheat events as well. Teachers may
   * never use it.
   */
  force?: boolean;
}

export interface RemoveExamResult {
  id: string;
  deletedAssignments: number;
  deletedAttempts: number;
  /** Attempts that were still in progress when the exam was force deleted. */
  deletedActiveAttempts: number;
  forced: boolean;
}

export async function remove(
  id: string,
  userId: string,
  role: string,
  options: RemoveExamOptions = {}
): Promise<RemoveExamResult> {
  const exam = await findOwnedExam(id, userId, role);
  const force = options.force === true;

  if (force && role !== "admin") {
    throw new ForbiddenError(
      "FORBIDDEN",
      "Chỉ quản trị viên mới có thể xoá cứng đề thi."
    );
  }

  if (!force && exam.status === "published") {
    throw new BadRequestError(
      "EXAM_CANNOT_EDIT_PUBLISHED",
      "Đề đã xuất bản không thể xoá trực tiếp. Hãy dùng “Sửa” để chuyển về nháp trước."
    );
  }

  if (!force) {
    const hasAttempt = await AttemptModel.exists({ examId: exam._id });
    if (hasAttempt) {
      throw new BadRequestError(
        "EXAM_HAS_ATTEMPTS",
        "Không thể xoá đề đã có học sinh làm bài."
      );
    }
  }

  let deletedAttempts = 0;
  let deletedActiveAttempts = 0;

  if (force) {
    // Force delete also stops students who are still working on the exam: the
    // admin has explicitly confirmed a hard delete, so leaving the exam behind
    // would keep an orphaned attempt alive forever.
    deletedActiveAttempts = await AttemptModel.countDocuments({
      examId: exam._id,
      status: "in_progress",
    });

    // Delete children before the parent: the repo has no transactions, so a
    // failure halfway leaves the exam in place and the operation can be retried.
    const attemptIds = await AttemptModel.distinct("_id", { examId: exam._id });
    if (attemptIds.length > 0) {
      await WritingReviewModel.deleteMany({ attemptId: { $in: attemptIds } });
      await ExamEventModel.deleteMany({ attemptId: { $in: attemptIds } });
    }
    const attemptResult = await AttemptModel.deleteMany({ examId: exam._id });
    deletedAttempts = attemptResult.deletedCount ?? 0;
  }

  const assignmentResult = await AssignmentModel.deleteMany({ examId: exam._id });
  const deletedAssignments = assignmentResult.deletedCount ?? 0;

  await ExamModel.deleteOne({ _id: exam._id });

  if (force) {
    logger.warn("exam.force_deleted", {
      examId: exam._id.toString(),
      adminId: userId,
      deletedAttempts,
      deletedActiveAttempts,
      deletedAssignments,
    });
  }

  return {
    id: exam._id.toString(),
    deletedAssignments,
    deletedAttempts,
    deletedActiveAttempts,
    forced: force,
  };
}

/**
 * Reopen a closed exam. Reuses the publish validation so an exam can never be
 * reopened in a state that could not have been published. A `closeAt` in the
 * past is cleared, otherwise the exam would be "open" but still blocked.
 */
export async function reopen(
  id: string,
  userId: string,
  role: string
): Promise<{ id: string; status: ExamStatus; clearedCloseAt?: boolean }> {
  const exam = await findOwnedExam(id, userId, role);

  if (exam.status !== "closed") {
    throw new BadRequestError(
      "EXAM_NOT_CLOSED",
      "Chỉ có thể mở lại đề thi đang ở trạng thái đã đóng."
    );
  }

  const originalCloseAt = exam.closeAt;
  const hadPastCloseAt = Boolean(
    originalCloseAt && originalCloseAt.getTime() <= Date.now()
  );

  if (hadPastCloseAt) {
    exam.closeAt = undefined;
    await exam.save();
  }

  try {
    const result = await publish(id, userId, role);
    return hadPastCloseAt ? { ...result, clearedCloseAt: true } : result;
  } catch (error) {
    if (hadPastCloseAt) {
      exam.closeAt = originalCloseAt;
      await exam.save();
    }
    throw error;
  }
}

/**
 * Convert a published/closed exam back to draft so its content can be edited
 * again. Exams that already have attempts are rejected: editing them would
 * change the exam students were graded against (the UI offers clone-to-edit).
 */
export async function convertToDraft(
  id: string,
  userId: string,
  role: string
): Promise<{ id: string; status: ExamStatus; clearedCloseAt?: boolean }> {
  const exam = await findOwnedExam(id, userId, role);

  if (exam.status === "draft") {
    return { id: exam._id.toString(), status: exam.status };
  }

  const hasAttempt = await AttemptModel.exists({ examId: exam._id });
  if (hasAttempt) {
    throw new BadRequestError(
      "EXAM_HAS_ATTEMPTS",
      "Đề đã có học sinh làm bài. Hãy nhân bản đề để chỉnh sửa."
    );
  }

  // A closed exam normally has a past `closeAt`. Keeping it would silently
  // block students again right after the teacher re-publishes the draft.
  const hadPastCloseAt = Boolean(
    exam.closeAt && exam.closeAt.getTime() <= Date.now()
  );
  if (hadPastCloseAt) exam.closeAt = undefined;

  exam.status = "draft";
  await exam.save();

  return {
    id: exam._id.toString(),
    status: exam.status,
    ...(hadPastCloseAt ? { clearedCloseAt: true } : {}),
  };
}

export async function clone(
  id: string,
  userId: string,
  role: string
): Promise<{ id: string; title: string; status: ExamStatus }> {
  const original = await ExamModel.findById(id);

  if (!original) {
    throw new NotFoundError("Đề thi không tồn tại.");
  }

  assertOwnership(original, userId, role);

  const clonedKind = original.kind ?? "mock";
  const clonedScoringMode: ExamScoringMode =
    clonedKind === "practice" ? "raw" : original.scoringMode ?? "band";

  const clonedSections = normalizeExamSectionNumbering(
    original.sections.map((section) => ({
      skill: section.skill,
      part: section.part,
      title: section.title,
      instructions: section.instructions,
      instructionsDoc: section.instructionsDoc,
      passageText: section.passageText,
      passageDoc: section.passageDoc,
      transcript: section.transcript,
      mediaIds: section.mediaIds,
      questionGroups: section.questionGroups,
    }))
  ).sections;

  const cloned = await ExamModel.create({
    title: `[Bản sao] ${original.title}`,
    description: original.description,
    kind: clonedKind,
    scoringMode: clonedScoringMode,
    bandConversion:
      clonedKind === "mock" && clonedScoringMode === "band"
        ? normalizeBandConversion(original.bandConversion)
        : undefined,
    disableTextSelection: original.disableTextSelection ?? false,
    curriculum: original.curriculum,
    postSubmissionResources: original.postSubmissionResources,
    durationMinutes: original.durationMinutes,
    sections: clonedSections,
    status: "draft",
    openAt: original.openAt,
    closeAt: original.closeAt,
    createdBy: new mongoose.Types.ObjectId(userId),
  });

  return { id: cloned._id.toString(), title: cloned.title, status: cloned.status };
}



export async function publish(
  id: string,
  userId: string,
  role: string
): Promise<{ id: string; status: ExamStatus }> {
  const exam = await findOwnedExam(id, userId, role);

  validateExamReadyForPublish(exam);

  exam.status = "published";
  await exam.save();

  return { id: exam._id.toString(), status: exam.status };
}

export async function unpublish(
  id: string,
  userId: string,
  role: string
): Promise<{ id: string; status: ExamStatus }> {
  const exam = await findOwnedExam(id, userId, role);

  if (exam.status !== "published") {
    throw new BadRequestError(
      "EXAM_NOT_PUBLISHED",
      "Chỉ có thể hủy xuất bản đề thi đang ở trạng thái published."
    );
  }

  const attemptCount = await AttemptModel.countDocuments({ examId: exam._id });
  if (attemptCount > 0) {
    throw new BadRequestError(
      "EXAM_HAS_ATTEMPTS",
      "Không thể hủy xuất bản đề thi đã có học sinh làm bài."
    );
  }

  exam.status = "draft";
  await exam.save();

  return { id: exam._id.toString(), status: exam.status };
}

export async function close(
  id: string,
  userId: string,
  role: string
): Promise<{ id: string; status: ExamStatus }> {
  const exam = await findOwnedExam(id, userId, role);

  exam.status = "closed";
  await exam.save();

  return { id: exam._id.toString(), status: exam.status };
}

export { assertOwnership, countExamPoints };
