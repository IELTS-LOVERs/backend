import mongoose, { type Types } from "mongoose";

const { Schema, model } = mongoose;

export type ExamEventType =
  | "TAB_SWITCH"
  | "WINDOW_BLUR"
  | "FULLSCREEN_EXIT"
  | "RELOAD"
  | "COPY"
  | "PASTE"
  | "CUT"
  | "CONTEXT_MENU"
  | "INTERRUPTION";

export interface IExamEvent extends mongoose.Document {
  _id: Types.ObjectId;
  attemptId: Types.ObjectId;
  studentId: Types.ObjectId;
  type: ExamEventType;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const ExamEventSchema = new Schema<IExamEvent>(
  {
    attemptId: { type: Schema.Types.ObjectId, ref: "Attempt", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: [
        "TAB_SWITCH",
        "WINDOW_BLUR",
        "FULLSCREEN_EXIT",
        "RELOAD",
        "COPY",
        "PASTE",
        "CUT",
        "CONTEXT_MENU",
        "INTERRUPTION",
      ],
      required: true,
    },
    timestamp: { type: Date, required: true, default: Date.now },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

ExamEventSchema.index({ attemptId: 1, type: 1 });
ExamEventSchema.index({ studentId: 1 });

export const ExamEventModel = model<IExamEvent>("ExamEvent", ExamEventSchema);
