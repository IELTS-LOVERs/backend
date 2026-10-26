import mongoose, { type Types } from "mongoose";

const { Schema, model } = mongoose;

export type SkillType = "listening" | "reading" | "writing";

// Used for question groups embedded in exams AND for the question bank.
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
  | "writing_task_2";

/**
 * Legacy flat question types.
 *
 * @deprecated The bank stores Question Groups (`groupType`). Kept only so
 * remaining tooling/tests can reference the old shape.
 */
export type QuestionType =
  | "multiple_choice"
  | "multiple_choice_single"
  | "multiple_choice_multiple"
  | "form_completion"
  | "note_completion"
  | "table_completion"
  | "sentence_completion"
  | "matching"
  | "matching_headings"
  | "matching_information"
  | "matching_features"
  | "matching_sentence_endings"
  | "map_labelling"
  | "diagram_labelling"
  | "summary_completion"
  | "true_false_not_given"
  | "yes_no_not_given"
  | "short_answer"
  | "flow_chart_completion"
  | "writing_task_1"
  | "writing_task_2";

/** Opaque ProseMirror JSON stored in Mongo (`Schema.Types.Mixed`). */
export type RichDocValue = Record<string, unknown>;

/** One answer slot stored inside a bank Question Group. */
export interface IBankQuestionItem {
  _id: Types.ObjectId;
  prompt: string;
  /** Rich-text JSON for the prompt; `prompt` stays as the plain-text fallback. */
  promptDoc?: RichDocValue;
  acceptedAnswers: string[];
  points: number;
  explanation?: string;
  mediaIds: Types.ObjectId[];
}

/**
 * Question Bank document — a reusable Question Group template.
 *
 * Mirrors the shape embedded in an exam section (`ExamSection.questionGroups`)
 * minus `questionNumber` (numbers are assigned when the group is inserted into
 * an exam).
 */
export interface IQuestion extends mongoose.Document {
  _id: Types.ObjectId;
  skill: SkillType;
  part: number;
  groupType: QuestionGroupType;
  instructions: string;
  /** Rich-text JSON for the group instructions. */
  instructionsDoc?: RichDocValue;
  config: Record<string, unknown>;
  questions: IBankQuestionItem[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BankQuestionItemSchema = new Schema<IBankQuestionItem>(
  {
    prompt: { type: String, default: "" },
    promptDoc: { type: Schema.Types.Mixed },
    acceptedAnswers: [{ type: String, trim: true }],
    points: { type: Number, default: 1 },
    explanation: { type: String },
    mediaIds: [{ type: Schema.Types.ObjectId, ref: "Media" }],
  },
  { _id: true }
);

const QuestionSchema = new Schema<IQuestion>(
  {
    skill: { type: String, enum: ["listening", "reading", "writing"], required: true },
    part: { type: Number, required: true },
    groupType: { type: String, required: true },
    instructions: { type: String, default: "" },
    instructionsDoc: { type: Schema.Types.Mixed },
    config: { type: Schema.Types.Mixed, default: {} },
    questions: [BankQuestionItemSchema],

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

QuestionSchema.index({ skill: 1, part: 1, groupType: 1 });
QuestionSchema.index({ createdBy: 1 });

// A bank entry is a Question Group: it must contain at least one question.
QuestionSchema.path("questions").validate(function (value: IBankQuestionItem[]) {
  return Array.isArray(value) && value.length > 0;
}, "Nhóm câu hỏi phải có ít nhất 1 câu");

export const QuestionModel = model<IQuestion>("Question", QuestionSchema);
