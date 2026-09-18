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
  task1: ITaskGrade;
  task2: ITaskGrade;
  overallWritingScore: number;
  generalFeedback?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TaskGradeSchema = new Schema<ITaskGrade>(
  {
    score: { type: Number, required: true, min: 0, max: 9.0 },
    comment: { type: String },
  },
  { _id: false }
);

const WritingReviewSchema = new Schema<IWritingReview>(
  {
    attemptId: { type: Schema.Types.ObjectId, ref: "Attempt", required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    task1: { type: TaskGradeSchema, required: true },
    task2: { type: TaskGradeSchema, required: true },
    overallWritingScore: { type: Number, required: true, min: 0, max: 9.0 },
    generalFeedback: { type: String },
  },
  { timestamps: true, versionKey: false }
);

WritingReviewSchema.index({ attemptId: 1 }, { unique: true });
WritingReviewSchema.index({ teacherId: 1 });
WritingReviewSchema.index({ studentId: 1 });

export const WritingReviewModel = model<IWritingReview>(
  "WritingReview",
  WritingReviewSchema
);
