import mongoose, { type Types } from "mongoose";

const { Schema, model } = mongoose;

export type UserRole = "student" | "teacher" | "admin";

export type UserStatus = "active" | "inactive" | "suspended";

export interface IConsumedRefreshHash {
  tokenHash: string;
  rotatedAt: Date;
}

export interface IRefreshSession {
  /**
   * ID của phiên, được nhúng vào access/refresh token. Với role bị giới hạn
   * một thiết bị, `User.activeSessionId` phải khớp với giá trị này.
   * Optional để tương thích các session cũ trước khi bật chính sách.
   */
  sessionId?: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent?: string;
  /**
   * I-1: hashes consumed by recent rotations of this session. Used to tell a
   * benign multi-tab refresh race (presented within a short grace window) apart
   * from a genuine replay of a long-rotated token.
   */
  consumedTokenHashes: IConsumedRefreshHash[];
}

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
  /** FIX-04: server-side refresh sessions (hashed tokens) for rotation/revocation. */
  refreshSessions: IRefreshSession[];
  /**
   * Session đang hoạt động của các role bị giới hạn một thiết bị (mặc định
   * student). Access token có `sid` khác giá trị này sẽ bị từ chối ngay.
   */
  activeSessionId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ConsumedRefreshHashSchema = new Schema<IConsumedRefreshHash>(
  {
    tokenHash: { type: String, required: true },
    rotatedAt: { type: Date, required: true },
  },
  { _id: false }
);

const RefreshSessionSchema = new Schema<IRefreshSession>(
  {
    sessionId: { type: String },
    tokenHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String },
    consumedTokenHashes: { type: [ConsumedRefreshHashSchema], default: [] },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    role: { type: String, enum: ["student", "teacher", "admin"], default: "student" },
    targetBand: { type: Number, min: 0, max: 9.0 },
    avatarMediaId: { type: Schema.Types.ObjectId, ref: "Media" },
    status: { type: String, enum: ["active", "inactive", "suspended"], default: "active" },
    tokenVersion: { type: Number, default: 0 },
    refreshSessions: { type: [RefreshSessionSchema], default: [] },
    activeSessionId: { type: String },
  },
  { timestamps: true, versionKey: false }
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ role: 1, status: 1 });

export const UserModel = model<IUser>("User", UserSchema);
