import mongoose, { type Types } from "mongoose";

const { Schema, model } = mongoose;

export type SkillType = "listening" | "reading" | "writing";

export type QuestionType =
  | "multiple_choice"
  | "form_completion"
  | "note_completion"
  | "table_completion"
  | "sentence_completion"
  | "matching"
  | "map_labelling"
  | "diagram_labelling"
  | "matching_headings"
  | "summary_completion"
  | "true_false_not_given"
  | "yes_no_not_given"
  | "writing_task_1"
  | "writing_task_2";

export interface IQuestion extends mongoose.Document {
  _id: Types.ObjectId;
  skill: SkillType;
  type: QuestionType;
  part: number;
  prompt: string;
  content?: string;
  data: Record<string, unknown>;
  acceptedAnswers: string[];
  points: number;
  explanation?: string;
  mediaIds: Types.ObjectId[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionSchema = new Schema<IQuestion>(
  {
    skill: { type: String, enum: ["listening", "reading", "writing"], required: true },
    type: { type: String, required: true },
    part: { type: Number, required: true },
    prompt: { type: String, required: true },
    content: { type: String },
    data: { type: Schema.Types.Mixed, default: {} },
    acceptedAnswers: [{ type: String, trim: true }],
    points: { type: Number, default: 1 },
    explanation: { type: String },
    mediaIds: [{ type: Schema.Types.ObjectId, ref: "Media" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

QuestionSchema.index({ skill: 1, part: 1, type: 1 });
QuestionSchema.index({ createdBy: 1 });

export const QuestionModel = model<IQuestion>("Question", QuestionSchema);
