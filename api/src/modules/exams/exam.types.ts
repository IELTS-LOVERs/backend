import type { Types } from "mongoose";
import type { CandidateExam, CandidateMediaItem } from "../attempts/attempt.types.js";
import type { SkillType, QuestionGroupType } from "../questions/question.model.js";
import type {
  ExamStatus,
  ExamKind,
  ExamScoringMode,
  IBandConversion,
  IExamCurriculum,
  IExamPostSubmissionResources,
  RichDocValue,
} from "./exam.model.js";

export interface ExamSummary {
  id: string;
  title: string;
  durationMinutes: number;
  status: ExamStatus;
  kind: ExamKind;
  scoringMode: ExamScoringMode;
  bandConversion?: IBandConversion;
  disableTextSelection?: boolean;
  curriculum?: IExamCurriculum;
  sectionsCount: number;
  type?: ExamKind;
}

export interface ExamListItem {
  id: string;
  title: string;
  durationMinutes: number;
  status: ExamStatus;
  kind: ExamKind;
  scoringMode: ExamScoringMode;
  bandConversion?: IBandConversion;
  curriculum?: IExamCurriculum;
  sectionsCount: number;
  /** Distinct skills present in the sections, in IELTS order. */
  skills: SkillType[];
  createdAt: Date;
  type?: ExamKind;
  /** True when at least one student has attempted this exam (teacher view). */
  hasAttempts?: boolean;
  /** True when the exam is assigned to at least one class (teacher view). */
  hasAssignments?: boolean;
  /** Total attempts ever started on this exam (teacher view). */
  attemptsCount?: number;
  /** Attempts currently in progress (teacher view). */
  activeAttemptsCount?: number;
  contentRevision?: number;
}

export interface SerializedQuestionItem {
  id: string;
  questionNumber: number;
  prompt: string;
  promptDoc?: RichDocValue | null;
  acceptedAnswers: string[];
  points: number;
  explanation: string | null;
  mediaIds: string[];
}

export interface SerializedQuestionGroup {
  id: string;
  groupType: QuestionGroupType;
  instructions: string;
  instructionsDoc?: RichDocValue | null;
  config: Record<string, unknown>;
  /** Resolved group-level image (config.imageMediaId) with a presigned URL. */
  media: CandidateMediaItem[];
  questions: SerializedQuestionItem[];
}

export interface ExamSectionDetail {
  id: string;
  skill: SkillType;
  part: number;
  title: string;
  instructions: string | null;
  instructionsDoc?: RichDocValue | null;
  passageText: string | null;
  passageDoc?: RichDocValue | null;
  transcript: string | null;
  mediaIds: string[];
  media: CandidateMediaItem[];
  questionGroups: SerializedQuestionGroup[];
}

export interface ExamDetail {
  id: string;
  title: string;
  description: string | null;
  bannerUrl?: string | null;
  durationMinutes: number;
  status: ExamStatus;
  kind: ExamKind;
  scoringMode: ExamScoringMode;
  bandConversion?: IBandConversion;
  disableTextSelection: boolean;
  bandConversionDefaults?: {
    listening: Array<{ minRaw: number; band: number }>;
    readingAcademic: Array<{ minRaw: number; band: number }>;
    readingGeneral: Array<{ minRaw: number; band: number }>;
  };
  curriculum?: IExamCurriculum;
  postSubmissionResources?: IExamPostSubmissionResources;
  openAt: Date | null;
  closeAt: Date | null;
  /** True when at least one student has attempted this exam (teacher view). */
  hasAttempts?: boolean;
  /** True when the exam is assigned to at least one class (teacher view). */
  hasAssignments?: boolean;
  /** Total attempts ever started on this exam (teacher view). */
  attemptsCount?: number;
  /** Attempts currently in progress (teacher view). */
  activeAttemptsCount?: number;
  contentRevision: number;
  sections: ExamSectionDetail[];
  type?: ExamKind;
}

export interface StudentExamDetail extends CandidateExam {
  durationMinutes: number;
  status: ExamStatus;
  kind: ExamKind;
  scoringMode?: ExamScoringMode;
  bandConversion?: IBandConversion;
  curriculum?: IExamCurriculum;
  type?: ExamKind;
}

export type ExamListSort =
  | "date_desc"
  | "date_asc"
  | "title_asc"
  | "title_desc"
  | "collection_asc";

export interface ListExamsFilters {
  status?: ExamStatus;
  kind?: ExamKind;
  type?: ExamKind;
  skill?: SkillType;
  collectionName?: string;
  search?: string;
  sort?: ExamListSort;
  page: number;
  limit: number;
}

export interface ExamFilter {
  status?: ExamStatus;
  kind?: ExamKind | { $in: Array<ExamKind | null> };
  createdBy?: string;
  _id?: { $in: Types.ObjectId[] };
  "sections.skill"?: SkillType;
  $and?: Array<Record<string, unknown>>;
}

/** Mongo sort specs for the teacher practice list. */
export const EXAM_LIST_SORTS: Record<ExamListSort, Record<string, 1 | -1>> = {
  date_desc: { createdAt: -1 },
  date_asc: { createdAt: 1 },
  title_asc: { title: 1, createdAt: -1 },
  title_desc: { title: -1, createdAt: -1 },
  collection_asc: {
    "curriculum.collectionName": 1,
    "curriculum.testNumber": 1,
    "curriculum.part": 1,
    title: 1,
  },
};
