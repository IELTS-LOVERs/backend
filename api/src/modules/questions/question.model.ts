import mongoose, { type Types } from "mongoose";

const { Schema, model } = mongoose;

export type SkillType = "listening" | "reading" | "writing" | "speaking";

// New: Used for question groups embedded in exams
export type QuestionGroupType =
  | "multiple_choice_single"
  | "multiple_choice_multiple"
  | "true_false_not_given"
  | "yes_no_not_given"
  | "matching_headings"
  | "matching_information"
  | "matching_features"
  | "matching_sentence_endings"
  | "sentence_completion"
  | "note_completion"
  | "table_completion"
  | "summary_completion"
  | "summary_completion_options"
  | "form_completion"
  | "flow_chart_completion"
  | "map_labelling"
  | "diagram_labelling"
  | "short_answer"
  | "writing_task_1"
  | "writing_task_2"
  | "speaking_part_1"
  | "speaking_part_2"
  | "speaking_part_3";

export type QuestionType =
  | "multiple_choice"          // legacy, maps to multiple_choice_single
  | "multiple_choice_single"   // NEW
  | "multiple_choice_multiple" // NEW
  | "form_completion"
  | "note_completion"
  | "table_completion"
  | "sentence_completion"
  | "matching"                 // legacy, generic matching
  | "matching_headings"
  | "matching_information"     // NEW
  | "matching_features"        // NEW
  | "matching_sentence_endings" // NEW
  | "map_labelling"
  | "diagram_labelling"
  | "summary_completion"
  | "true_false_not_given"
  | "yes_no_not_given"
  | "short_answer"             // NEW
  | "flow_chart_completion"    // NEW
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
    skill: { type: String, enum: ["listening", "reading", "writing", "speaking"], required: true },
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
