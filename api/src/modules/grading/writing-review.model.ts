import mongoose, { type Types } from "mongoose";

const { Schema, model } = mongoose;

export interface ITaskGrade {
  score: number;
  comment?: string;
}

export interface IWritingReview extends mongoose.Document {
  _id: Types.ObjectId;
  attemptId: Types.ObjectId;
  studentId: Types.ObjectId;
  teacherId: Types.ObjectId;
  task1?: ITaskGrade;
  task2?: ITaskGrade;
  overallWritingScore: number;
  generalFeedback?: string;
  createdAt: Date;
  updatedAt: Date;
}

const halfBandValidator = {
  validator: (value: number) => Number.isInteger(value * 2),
  message: "Điểm Writing phải theo bước 0.5.",
};

const TaskGradeSchema = new Schema<ITaskGrade>(
  {
    score: { type: Number, required: true, min: 0, max: 9.0, validate: halfBandValidator },
    comment: { type: String },
  },
  { _id: false }
);

const WritingReviewSchema = new Schema<IWritingReview>(
  {
    attemptId: { type: Schema.Types.ObjectId, ref: "Attempt", required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    task1: { type: TaskGradeSchema, required: false },
    task2: { type: TaskGradeSchema, required: false },
    overallWritingScore: {
      type: Number,
      required: true,
      min: 0,
      max: 9.0,
      validate: halfBandValidator,
    },
    generalFeedback: { type: String },
  },
  { timestamps: true, versionKey: false }
);

WritingReviewSchema.pre("validate", function () {
  if (!this.task1 && !this.task2) {
    this.invalidate("task1", "Phải nhập điểm cho ít nhất một Task Writing.");
  }
});

WritingReviewSchema.index({ attemptId: 1 }, { unique: true });
WritingReviewSchema.index({ teacherId: 1 });
WritingReviewSchema.index({ studentId: 1 });

export const WritingReviewModel = model<IWritingReview>(
  "WritingReview",
  WritingReviewSchema
);
