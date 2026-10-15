import mongoose, { type Types } from "mongoose";
import type { SkillType, QuestionGroupType } from "../questions/question.model.js";

const { Schema, model } = mongoose;

export type ExamStatus = "draft" | "published" | "closed";

export interface IQuestionItem {
  _id: Types.ObjectId;
  questionNumber: number;
  prompt: string;
  acceptedAnswers: string[];
  points: number;
  explanation?: string;
  mediaIds?: Types.ObjectId[];
}

export interface IQuestionGroup {
  _id: Types.ObjectId;
  groupType: QuestionGroupType;
  instructions: string;
  config: Record<string, unknown>;
  questions: IQuestionItem[];
}

export interface IExamSection {
  _id: Types.ObjectId;
  skill: SkillType;
  part: number;
  title?: string;
  instructions?: string;
  passageText?: string;
  transcript?: string;
  mediaIds?: Types.ObjectId[];
  questionGroups: IQuestionGroup[];
}

export interface IExam extends mongoose.Document {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  durationMinutes: number;
  sections: IExamSection[];
  status: ExamStatus;
  openAt?: Date;
  closeAt?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionItemSchema = new Schema<IQuestionItem>(
  {
    questionNumber: { type: Number, required: true },
    prompt: { type: String, default: "" },
    acceptedAnswers: [{ type: String, trim: true }],
    points: { type: Number, default: 1 },
    explanation: { type: String },
    mediaIds: [{ type: Schema.Types.ObjectId, ref: "Media" }],
  },
  { _id: true }
);

const QuestionGroupSchema = new Schema<IQuestionGroup>(
  {
    groupType: { type: String, required: true },
    instructions: { type: String, default: "" },
    config: { type: Schema.Types.Mixed, default: {} },
    questions: [QuestionItemSchema],
  },
  { _id: true }
);

const ExamSectionSchema = new Schema<IExamSection>(
  {
    skill: { type: String, enum: ["listening", "reading", "writing"], required: true },
    part: { type: Number, required: true },
    title: { type: String, default: "" },
    instructions: { type: String },
    passageText: { type: String },
    transcript: { type: String },
    mediaIds: [{ type: Schema.Types.ObjectId, ref: "Media" }],
    questionGroups: [QuestionGroupSchema],
  },
  { _id: true }
);

const ExamSchema = new Schema<IExam>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    durationMinutes: { type: Number, required: true, default: 60 },
    sections: [ExamSectionSchema],
    status: { type: String, enum: ["draft", "published", "closed"], default: "draft" },
    openAt: { type: Date },
    closeAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

ExamSchema.index({ status: 1, createdBy: 1 });
ExamSchema.index({ openAt: 1, closeAt: 1 });

export const ExamModel = model<IExam>("Exam", ExamSchema);
