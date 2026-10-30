import mongoose, { type Types } from "mongoose";

const { Schema, model } = mongoose;

export interface ICollection extends mongoose.Document {
  _id: Types.ObjectId;
  name: string;
  parentId?: Types.ObjectId | null;
  description?: string;
  bannerUrl?: string;
  orderIndex: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CollectionSchema = new Schema<ICollection>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: "Collection",
      default: null,
    },
    description: { type: String, trim: true, maxlength: 500 },
    bannerUrl: { type: String, trim: true },
    orderIndex: { type: Number, default: 0, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false, strict: false }
);

CollectionSchema.index({ name: 1 }, { unique: true });
CollectionSchema.index({ parentId: 1, orderIndex: 1 });
CollectionSchema.index({ createdBy: 1 });

export const CollectionModel = model<ICollection>("Collection", CollectionSchema);
