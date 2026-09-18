import mongoose, { type Types } from "mongoose";

const { Schema, model } = mongoose;

export type AttemptStatus = "in_progress" | "submitted" | "expired";

export interface IAttemptAnswer {
  questionId: Types.ObjectId;
  value: string;
  savedAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
}

const AttemptAnswerSchema = new Schema<IAttemptAnswer>(
  {
    questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
    value: { type: String, required: true },
    savedAt: { type: Date, default: Date.now },
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
  },
  { timestamps: true, versionKey: false }
);

AttemptSchema.index({ studentId: 1, examId: 1 });
AttemptSchema.index({ assignmentId: 1 });
AttemptSchema.index({ status: 1, expiresAt: 1 });
AttemptSchema.index(
  { studentId: 1, examId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "in_progress" },
    name: "unique_student_exam_in_progress",
  }
);

export const AttemptModel = model<IAttempt>("Attempt", AttemptSchema);
