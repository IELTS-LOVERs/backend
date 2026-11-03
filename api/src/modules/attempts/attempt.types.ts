import type { Types } from "mongoose";
import type { SkillType, QuestionGroupType } from "../questions/question.model.js";
import type {
  ExamKind,
  IQuestionGroup,
  IExamPostSubmissionResources,
  RichDocValue,
} from "../exams/exam.model.js";
import type {
  AttemptStatus,
  IAttemptResultDetail,
  IAttemptScores,
} from "./attempt.model.js";

export interface CandidateMediaItem {
  id: string;
  url: string;
  type: "audio" | "image";
  originalName: string;
}

export interface CandidateQuestionItem {
  id: string;
  questionNumber: number;
  prompt: string;
  promptDoc?: RichDocValue | null;
  points: number;
  mediaIds: string[];
  media: CandidateMediaItem[];
}

export interface CandidateQuestionGroup {
  id: string;
  groupType: QuestionGroupType;
  instructions: string;
  instructionsDoc?: RichDocValue | null;
  config: Record<string, unknown>;
  /** Resolved group-level image (config.imageMediaId) with a presigned URL. */
  media: CandidateMediaItem[];
  questions: CandidateQuestionItem[];
}

export interface CandidateExamSection {
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
  questionGroups: CandidateQuestionGroup[];
}

export interface CandidateExam {
  id: string;
  title: string;
  kind: ExamKind;
  scoringMode?: "band" | "raw";
  disableTextSelection?: boolean;
  sections: CandidateExamSection[];
}

export interface StartAttemptResult {
  attemptId: string;
  examId: string;
  startedAt: Date;
  expiresAt: Date;
  remainingSeconds: number;
  status: AttemptStatus;
  exam: CandidateExam;
  /** Current content revision of the exam (see `Exam.contentRevision`). */
  revision: number;
}

export interface RecoveryAnswer {
  questionId: string;
  value: string;
}

export interface AttemptRecoveryResult {
  attemptId: string;
  status: AttemptStatus;
  remainingSeconds: number;
  answers: RecoveryAnswer[];
  exam: CandidateExam;
  /** Current content revision of the exam (see `Exam.contentRevision`). */
  revision: number;
}

export interface AttemptRevisionResult {
  revision: number;
  status: AttemptStatus;
  remainingSeconds: number;
}

export interface AttemptExamResult {
  exam: CandidateExam;
  revision: number;
  remainingSeconds: number;
  updatedAt: Date;
}

export interface AutosaveResult {
  savedCount: number;
  serverRemainingSeconds: number;
}

export interface SubmitAttemptResult {
  attemptId: string;
  status: AttemptStatus;
  submittedAt: Date;
  scores: IAttemptScores;
  message?: string;
}

export interface ResultQuestionDetail {
  questionId: string;
  questionNumber?: number;
  groupType?: string;
  skill?: "listening" | "reading" | "writing";
  studentAnswer: string | null;
  acceptedAnswers: string[];
  isCorrect: boolean;
  explanation: string | null;
  /** Maximum points of the question at snapshot time. */
  points?: number;
  /** Question prompt frozen at submit time (survives later exam edits). */
  prompt?: string;
}

export interface AttemptWritingReview {
  id: string;
  attemptId: string;
  task1?: {
    score: number;
    comment: string | null;
  };
  task2?: {
    score: number;
    comment: string | null;
  };
  overallWritingScore: number;
  generalFeedback: string | null;
  teacherId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttemptResult {
  attemptId: string;
  examId: string;
  examTitle?: string;
  examDurationMinutes?: number;
  studentName?: string;
  studentEmail?: string;
  status: AttemptStatus;
  startedAt?: Date;
  submittedAt?: Date;
  durationSeconds?: number;
  scores: IAttemptScores;
  writingReview: AttemptWritingReview | null;
  details: ResultQuestionDetail[];
  postSubmissionResources?: IExamPostSubmissionResources | null;
  examKind?: ExamKind;
  scoreMode?: "band" | "raw";
  questionCount?: number;
  totalPoints?: number;
  rawScore?: number;
  percentage?: number;
  correctCount?: number;
  wrongCount?: number;
  blankCount?: number;
  assignmentId?: string | null;
  maxAttempts?: number | null;
  attemptsUsed?: number;
  canRetake?: boolean;
}

export interface RawPopulatedSection {
  _id?: Types.ObjectId;
  skill: SkillType;
  part: number;
  title: string;
  instructions?: string;
  instructionsDoc?: RichDocValue;
  passageText?: string;
  passageDoc?: RichDocValue;
  transcript?: string;
  mediaIds?: unknown[];
  questionGroups?: IQuestionGroup[];
}

export interface RawExamObject {
  _id: Types.ObjectId;
  title: string;
  sections?: RawPopulatedSection[];
}

export interface GradableGroupQuestion {
  _id: Types.ObjectId;
  questionNumber: number;
  acceptedAnswers: string[];
  points: number;
  groupConfig: Record<string, unknown>;
  groupType: QuestionGroupType;
  /** Owning group id — needed to grade multi-answer groups as a set. */
  groupId?: string;
}

export interface ExamQuestionBuckets {
  hasListening: boolean;
  hasReading: boolean;
  hasWriting: boolean;
  listeningGrouped: GradableGroupQuestion[];
  readingGrouped: GradableGroupQuestion[];
}

export interface GradeBreakdown {
  rawScore: number;
  correctCount: number;
  wrongCount: number;
  blankCount: number;
}

export interface BuiltResultSnapshot {
  details: IAttemptResultDetail[];
  questionCount: number;
  totalPoints: number;
}
