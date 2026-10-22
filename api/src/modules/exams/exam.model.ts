import mongoose, { type Types } from "mongoose";
import type { SkillType, QuestionGroupType } from "../questions/question.model.js";

const { Schema, model } = mongoose;

export type ExamStatus = "draft" | "published" | "closed";
export type ExamKind = "practice" | "mock";
export type ExamScoringMode = "band" | "raw";
export type BandConversionMode = "auto" | "custom";
export type ReadingTrainingType = "academic" | "general";

export interface IBandThreshold {
  minRaw: number;
  band: number;
}

export interface IBandConversion {
  mode: BandConversionMode;
  readingType: ReadingTrainingType;
  listeningThresholds?: IBandThreshold[];
  readingThresholds?: IBandThreshold[];
}

export const DEFAULT_BAND_CONVERSION: IBandConversion = {
  mode: "auto",
  readingType: "academic",
};

// Deprecated alias for backwards compatibility
export type ExamType = ExamKind;

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

export interface IExamCurriculum {
  collectionName?: string; // "Cambridge IELTS 18"
  testNumber?: number;     // 1
  part?: number;           // 1..4 (map với section.part)
  orderIndex?: number;     // sort trong collection
}

// Deprecated alias for backwards compatibility
export type ICurriculum = IExamCurriculum;

export interface IExamVocabularyItem {
  _id?: Types.ObjectId;
  word: string;
  phonetic?: string;
  meaning: string;
  contextSentence?: string;
}

// Deprecated alias for backwards compatibility
export type IVocabularyItem = IExamVocabularyItem;

export interface IExamPostSubmissionResources {
  solutionVideoUrl?: string;
  solutionDocumentUrl?: string;
  solutionNotes?: string;
  vocabularyItems?: IExamVocabularyItem[];
}

// Deprecated alias for backwards compatibility
export type IPostSubmissionResources = IExamPostSubmissionResources;

export interface IExam extends mongoose.Document {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  bannerUrl?: string;
  kind: ExamKind;
  scoringMode: ExamScoringMode;
  bandConversion?: IBandConversion;
  curriculum?: IExamCurriculum;
  postSubmissionResources?: IExamPostSubmissionResources;
  durationMinutes: number;
  sections: IExamSection[];
  status: ExamStatus;
  openAt?: Date;
  closeAt?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  /** Deprecated alias for kind */
  type?: ExamKind;
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

const BandThresholdSchema = new Schema<IBandThreshold>(
  {
    minRaw: { type: Number, required: true, min: 0, max: 40 },
    band: { type: Number, required: true, min: 0, max: 9 },
  },
  { _id: false }
);

const BandConversionSchema = new Schema<IBandConversion>(
  {
    mode: { type: String, enum: ["auto", "custom"], default: "auto", required: true },
    readingType: {
      type: String,
      enum: ["academic", "general"],
      default: "academic",
      required: true,
    },
    listeningThresholds: { type: [BandThresholdSchema], default: undefined },
    readingThresholds: { type: [BandThresholdSchema], default: undefined },
  },
  { _id: false }
);

const ExamSchema = new Schema<IExam>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    bannerUrl: { type: String, trim: true },
    kind: {
      type: String,
      enum: ["practice", "mock"],
      default: "mock",
      required: true,
      index: true,
    },
    scoringMode: {
      type: String,
      enum: ["band", "raw"],
      default: "band",
      required: true,
    },
    bandConversion: {
      type: BandConversionSchema,
      default: undefined,
    },
    curriculum: {
      collectionName: { type: String, trim: true, maxlength: 120 },
      testNumber: { type: Number, min: 1 },
      part: { type: Number, min: 1, max: 4 },
      orderIndex: { type: Number, min: 0 },
    },
    postSubmissionResources: {
      solutionVideoUrl: { type: String, trim: true, maxlength: 2048 },
      solutionDocumentUrl: { type: String, trim: true, maxlength: 2048 },
      solutionNotes: { type: String, maxlength: 5000 },
      vocabularyItems: [
        {
          word: { type: String, required: true, trim: true, maxlength: 120 },
          phonetic: { type: String, trim: true, maxlength: 120 },
          meaning: { type: String, required: true, trim: true, maxlength: 500 },
          contextSentence: { type: String, trim: true, maxlength: 1000 },
        },
      ],
    },
    durationMinutes: { type: Number, required: true, default: 60 },
    sections: [ExamSectionSchema],
    status: { type: String, enum: ["draft", "published", "closed"], default: "draft" },
    openAt: { type: Date },
    closeAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for backwards compatibility with any remaining code reading .type
ExamSchema.virtual("type").get(function (this: IExam) {
  return this.kind ?? "mock";
});

ExamSchema.index({ status: 1, createdBy: 1 });
ExamSchema.index({ kind: 1, status: 1, createdBy: 1 });
ExamSchema.index({
  kind: 1,
  status: 1,
  "curriculum.collectionName": 1,
  "curriculum.orderIndex": 1,
});
ExamSchema.index({ openAt: 1, closeAt: 1 });

export const ExamModel = model<IExam>("Exam", ExamSchema);
