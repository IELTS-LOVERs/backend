import mongoose, { type Types } from "mongoose";

const { Schema, model } = mongoose;

export type AssignmentStatus = "active" | "archived";

export interface IAssignment extends mongoose.Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  teacherId: Types.ObjectId;
  classId?: Types.ObjectId;
  studentId?: Types.ObjectId;
  assignedAt: Date;
  deadline?: Date;
  status: AssignmentStatus;
  createdAt: Date;
  updatedAt: Date;
}

const AssignmentSchema = new Schema<IAssignment>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class" },
    studentId: { type: Schema.Types.ObjectId, ref: "User" },
    assignedAt: { type: Date, default: Date.now },
    deadline: { type: Date },
    status: { type: String, enum: ["active", "archived"], default: "active" },
  },
  { timestamps: true, versionKey: false }
);

AssignmentSchema.index({ classId: 1, status: 1 });
AssignmentSchema.index({ studentId: 1, status: 1 });
AssignmentSchema.index({ examId: 1 });

export const AssignmentModel = model<IAssignment>("Assignment", AssignmentSchema);
