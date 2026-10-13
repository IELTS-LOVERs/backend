import mongoose, { type Types } from "mongoose";

const { Schema, model } = mongoose;

export type MediaType = "audio" | "image";

export type MediaStatus = "pending" | "confirmed";

export interface IMedia extends mongoose.Document {
  _id: Types.ObjectId;
  bucket: string;
  key: string;
  originalName: string;
  mimeType: string;
  size: number;
  type: MediaType;
  status: MediaStatus;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MediaSchema = new Schema<IMedia>(
  {
    bucket: { type: String, required: true },
    key: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    type: { type: String, enum: ["audio", "image"], required: true },
    status: { type: String, enum: ["pending", "confirmed"], default: "pending" },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

MediaSchema.index({ key: 1 }, { unique: true });
MediaSchema.index({ uploadedBy: 1 });
MediaSchema.index({ status: 1, createdAt: 1 });

export const MediaModel = model<IMedia>("Media", MediaSchema);
