import mongoose, { type Types } from "mongoose";
import type { ExamKind, IBandConversion } from "../exams/exam.model.js";

const { Schema, model } = mongoose;

export type AttemptStatus = "in_progress" | "submitted" | "expired";

export interface IAttemptAnswer {
  questionId: Types.ObjectId;
  value: string;
  savedAt: Date;
}

/**
 * Snapshot of one graded question at submit time.
 *
 * The exam content can be edited after an attempt is submitted, so results
 * must never be derived from the live exam. `resultDetails` freezes the
 * question prompt, the accepted answers and the student's answer so both the
 * result page and manual Writing grading stay stable.
 */
export interface IAttemptResultDetail {
  questionId: Types.ObjectId;
  questionNumber?: number;
  groupType?: string;
  skill?: "listening" | "reading" | "writing";
  studentAnswer: string | null;
  acceptedAnswers: string[];
  isCorrect: boolean;
  explanation: string | null;
  prompt?: string;
  /** Maximum points of the question at snapshot time. */
  points?: number;
}

export interface IAttemptScores {
  listeningRaw?: number;
  listeningBand?: number;
  readingRaw?: number;
  readingBand?: number;
  writingTask1Band?: number;
  writingTask2Band?: number;
  writingBand?: number;
  overallBand?: number;
}

export interface IAttempt extends mongoose.Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  studentId: Types.ObjectId;
  assignmentId?: Types.ObjectId;
  startedAt: Date;
  expiresAt: Date;
  submittedAt?: Date;
  status: AttemptStatus;
  answers: IAttemptAnswer[];
  scores: IAttemptScores;
  suspicious: boolean;
  questionOrder: string[];
  examKind: ExamKind;
  scoringMode?: "band" | "raw";
  bandConversionSnapshot?: IBandConversion;
  skills: Array<"listening" | "reading" | "writing">;
  questionCount: number;
  /** Tổng điểm tối đa của đề tại thời điểm bắt đầu (dùng cho % practice). */
  totalPoints: number;
  correctCount?: number;
  wrongCount?: number;
  blankCount?: number;
  /** Immutable result snapshot written when the attempt is finalized. */
  resultDetails?: IAttemptResultDetail[];
  createdAt: Date;
  updatedAt: Date;
}

const AttemptAnswerSchema = new Schema<IAttemptAnswer>(
  {
    questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
    value: { type: String, default: "" },
    savedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const AttemptResultDetailSchema = new Schema<IAttemptResultDetail>(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    questionNumber: { type: Number },
    groupType: { type: String },
    skill: { type: String, enum: ["listening", "reading", "writing"] },
    studentAnswer: { type: String, default: null },
    acceptedAnswers: { type: [String], default: [] },
    isCorrect: { type: Boolean, default: false },
    explanation: { type: String, default: null },
    prompt: { type: String },
    points: { type: Number },
  },
  { _id: false }
);

const AttemptSchema = new Schema<IAttempt>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment" },
    startedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    submittedAt: { type: Date },
    status: {
      type: String,
      enum: ["in_progress", "submitted", "expired"],
      default: "in_progress",
    },
    answers: [AttemptAnswerSchema],
    scores: {
      listeningRaw: { type: Number },
      listeningBand: { type: Number },
      readingRaw: { type: Number },
      readingBand: { type: Number },
      writingTask1Band: { type: Number },
      writingTask2Band: { type: Number },
      writingBand: { type: Number },
      overallBand: { type: Number },
    },
    suspicious: { type: Boolean, default: false },
    questionOrder: { type: [String], default: [] },
    examKind: {
      type: String,
      enum: ["practice", "mock"],
      default: "mock",
      required: true,
      index: true,
    },
    // Snapshot để đổi scoringMode trên Exam không làm thay đổi kết quả cũ.
    scoringMode: { type: String, enum: ["band", "raw"] },
    bandConversionSnapshot: { type: Schema.Types.Mixed },
    skills: [{ type: String, enum: ["listening", "reading", "writing"] }],
    questionCount: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    correctCount: { type: Number },
    wrongCount: { type: Number },
    blankCount: { type: Number },
    resultDetails: { type: [AttemptResultDetailSchema], default: undefined },
  },
  { timestamps: true, versionKey: false }
);

AttemptSchema.index({ examId: 1, status: 1 });
AttemptSchema.index({ assignmentId: 1 });
AttemptSchema.index({ status: 1, expiresAt: 1 });
AttemptSchema.index({ studentId: 1, status: 1, submittedAt: 1 });
AttemptSchema.index({ studentId: 1, examKind: 1, status: 1, submittedAt: 1 });
AttemptSchema.index(
  { studentId: 1, examId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "in_progress" },
    name: "unique_student_exam_in_progress",
  }
);

export const AttemptModel = model<IAttempt>("Attempt", AttemptSchema);
