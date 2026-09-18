import mongoose, { type Types } from "mongoose";

const { Schema, model } = mongoose;

export interface IClass extends mongoose.Document {
  _id: Types.ObjectId;
  name: string;
  code: string;
  description?: string;
  teacherId: Types.ObjectId;
  students: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const ClassSchema = new Schema<IClass>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, trim: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    students: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true, versionKey: false }
);

ClassSchema.index({ code: 1 }, { unique: true });
ClassSchema.index({ teacherId: 1 });
ClassSchema.index({ students: 1 });

export const ClassModel = model<IClass>("Class", ClassSchema);
