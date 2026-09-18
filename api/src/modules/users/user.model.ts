import mongoose, { type Types } from "mongoose";

const { Schema, model } = mongoose;

export type UserRole = "student" | "teacher" | "admin";

export type UserStatus = "active" | "inactive" | "suspended";

export interface IUser extends mongoose.Document {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  fullName: string;
  phone?: string;
  role: UserRole;
  targetBand?: number;
  avatarMediaId?: Types.ObjectId;
  status: UserStatus;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    role: { type: String, enum: ["student", "teacher", "admin"], default: "student" },
    targetBand: { type: Number, min: 0, max: 9.0 },
    avatarMediaId: { type: Schema.Types.ObjectId, ref: "Media" },
    status: { type: String, enum: ["active", "inactive", "suspended"], default: "active" },
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ role: 1, status: 1 });

export const UserModel = model<IUser>("User", UserSchema);
