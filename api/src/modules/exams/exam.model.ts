import mongoose, { type Types } from "mongoose";
import type { SkillType } from "../questions/question.model.js";

const { Schema, model } = mongoose;

export type ExamStatus = "draft" | "published" | "closed";

export interface IExamSection {
  skill: SkillType;
  part: number;
  title: string;
  instructions?: string;
  passageText?: string;
  mediaIds?: Types.ObjectId[];
  questionIds: Types.ObjectId[];
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

const ExamSectionSchema = new Schema<IExamSection>(
  {
    skill: { type: String, enum: ["listening", "reading", "writing"], required: true },
    part: { type: Number, required: true },
    title: { type: String, required: true },
    instructions: { type: String },
    passageText: { type: String },
    mediaIds: [{ type: Schema.Types.ObjectId, ref: "Media" }],
    questionIds: [{ type: Schema.Types.ObjectId, ref: "Question" }],
  },
  { _id: false }
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
