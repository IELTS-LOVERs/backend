import type { IUser } from "../users/user.model.js";

export function toSafeUser(user: IUser) {
  return {
    id: user._id.toString(),
    email: user.email,
    fullName: user.fullName,
    phone: user.phone ?? null,
    role: user.role,
    targetBand: user.targetBand ?? null,
    status: user.status,
    avatarMediaId: user.avatarMediaId ? user.avatarMediaId.toString() : null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export type SafeUser = ReturnType<typeof toSafeUser>;
