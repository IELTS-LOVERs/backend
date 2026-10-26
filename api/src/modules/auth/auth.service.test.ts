import bcrypt from "bcrypt";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { env } from "../../config/env.js";
import { UserModel, type IRefreshSession, type IUser } from "../users/user.model.js";
import {
  generateTokens,
  hashRefreshToken,
  issueTokens,
  login,
  logout,
  refresh,
  signAccessToken,
  signRefreshToken,
} from "./auth.service.js";

const SID = "session-0001";

afterEach(() => {
  vi.restoreAllMocks();
});

function buildStudent(overrides: Partial<IUser> = {}): IUser {
  return {
    _id: new mongoose.Types.ObjectId("66e85d1c262f3b9200000002"),
    email: "student@example.com",
    role: "student",
    status: "active",
    tokenVersion: 0,
    refreshSessions: [],
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IUser;
}

function buildSession(
  token: string,
  overrides: Partial<IRefreshSession> = {}
): IRefreshSession {
  return {
    sessionId: SID,
    tokenHash: hashRefreshToken(token),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    consumedTokenHashes: [],
    ...overrides,
  };
}

function mockUpdateMatched(count = 1) {
  return vi
    .spyOn(UserModel, "updateOne")
    .mockResolvedValue({ matchedCount: count, modifiedCount: count } as never);
}

describe("auth.service token utilities", () => {
  const mockUser = {
    _id: new mongoose.Types.ObjectId("66e85d1c262f3b9200000001"),
    email: "student@example.com",
    role: "student",
  } as unknown as IUser;

  it("generates a valid signed access token with a session id", () => {
    const token = signAccessToken(mockUser, SID);
    expect(token).toBeDefined();

    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
      sub: string;
      role: string;
      email: string;
      sid?: string;
    };

    expect(decoded.sub).toBe("66e85d1c262f3b9200000001");
    expect(decoded.email).toBe("student@example.com");
    expect(decoded.role).toBe("student");
    expect(decoded.sid).toBe(SID);
  });

  it("generates a valid signed refresh token with the same session id", () => {
    const token = signRefreshToken(mockUser, SID);
    expect(token).toBeDefined();

    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as {
      sub: string;
      role: string;
      email: string;
      sid?: string;
    };

    expect(decoded.sub).toBe("66e85d1c262f3b9200000001");
    expect(decoded.email).toBe("student@example.com");
    expect(decoded.role).toBe("student");
    expect(decoded.sid).toBe(SID);
  });

  it("generates both access and refresh tokens sharing one sid", () => {
    const tokens = generateTokens(mockUser, SID);

    const accessDecoded = jwt.verify(tokens.accessToken, env.JWT_ACCESS_SECRET) as {
      sub: string;
      sid?: string;
    };
    const refreshDecoded = jwt.verify(tokens.refreshToken, env.JWT_REFRESH_SECRET) as {
      sub: string;
      sid?: string;
    };

    expect(accessDecoded.sub).toBe("66e85d1c262f3b9200000001");
    expect(refreshDecoded.sub).toBe("66e85d1c262f3b9200000001");
    expect(accessDecoded.sid).toBe(SID);
    expect(refreshDecoded.sid).toBe(SID);
  });
});

describe("single-device login (last-login-wins)", () => {
  it("keeps exactly one refresh session and replaces activeSessionId on every login", async () => {
    const user = buildStudent();

    const first = await issueTokens(user);
    const firstSid = (jwt.decode(first.accessToken) as { sid: string }).sid;

    const second = await issueTokens(user);
    const secondSid = (jwt.decode(second.accessToken) as { sid: string }).sid;

    expect(firstSid).not.toBe(secondSid);
    expect(user.refreshSessions).toHaveLength(1);
    expect(user.refreshSessions[0].sessionId).toBe(secondSid);
    expect(user.refreshSessions[0].tokenHash).toBe(hashRefreshToken(second.refreshToken));
    expect(user.activeSessionId).toBe(secondSid);
    expect(user.save).toHaveBeenCalled();
  });

  it("does not apply the single-session cap to teachers", async () => {
    const teacher = buildStudent({ role: "teacher", activeSessionId: undefined });

    const first = await issueTokens(teacher);
    const second = await issueTokens(teacher);

    expect(teacher.refreshSessions).toHaveLength(2);
    expect(teacher.activeSessionId).toBeUndefined();
    expect(jwt.decode(first.accessToken)).toBeDefined();
    expect(jwt.decode(second.accessToken)).toBeDefined();
  });

  it("reuses the sid when login comes with the active refresh cookie (same browser)", async () => {
    const user = buildStudent({
      passwordHash: "hashed-password",
      activeSessionId: SID,
    });
    const existingToken = signRefreshToken(user, SID);
    user.refreshSessions = [buildSession(existingToken)];

    vi.spyOn(UserModel, "findOne").mockResolvedValueOnce(user as never);
    vi.spyOn(bcrypt, "compare").mockResolvedValueOnce(true as never);

    const result = await login(
      { email: "student@example.com", password: "Password@1" },
      undefined,
      existingToken
    );

    expect((jwt.decode(result.accessToken) as { sid: string }).sid).toBe(SID);
    expect(user.activeSessionId).toBe(SID);
    expect(user.refreshSessions).toHaveLength(1);
    expect(user.refreshSessions[0].sessionId).toBe(SID);
    expect(user.refreshSessions[0].tokenHash).toBe(hashRefreshToken(result.refreshToken));
    // An in-flight refresh with the previous cookie is still recognized.
    expect(
      user.refreshSessions[0].consumedTokenHashes.map((entry) => entry.tokenHash)
    ).toContain(hashRefreshToken(existingToken));
  });

  it("creates a new sid when login comes from another device", async () => {
    const user = buildStudent({
      passwordHash: "hashed-password",
      activeSessionId: SID,
    });
    const existingToken = signRefreshToken(user, SID);
    user.refreshSessions = [buildSession(existingToken)];

    vi.spyOn(UserModel, "findOne").mockResolvedValueOnce(user as never);
    vi.spyOn(bcrypt, "compare").mockResolvedValueOnce(true as never);

    // No refresh cookie → new device.
    const result = await login({ email: "student@example.com", password: "Password@1" });

    const newSid = (jwt.decode(result.accessToken) as { sid: string }).sid;
    expect(newSid).not.toBe(SID);
    expect(user.activeSessionId).toBe(newSid);
    expect(user.refreshSessions).toHaveLength(1);
    expect(user.refreshSessions[0].sessionId).toBe(newSid);
    expect(result.sessionReplaced).toBe(true);
  });

  it("reports sessionReplaced=false on the very first login", async () => {
    const user = buildStudent({ passwordHash: "hashed-password" });

    vi.spyOn(UserModel, "findOne").mockResolvedValueOnce(user as never);
    vi.spyOn(bcrypt, "compare").mockResolvedValueOnce(true as never);

    const result = await login({ email: "student@example.com", password: "Password@1" });

    expect(result.sessionReplaced).toBe(false);
  });

  it("reports sessionReplaced=false when the same browser reuses its session", async () => {
    const user = buildStudent({
      passwordHash: "hashed-password",
      activeSessionId: SID,
    });
    const existingToken = signRefreshToken(user, SID);
    user.refreshSessions = [buildSession(existingToken)];

    vi.spyOn(UserModel, "findOne").mockResolvedValueOnce(user as never);
    vi.spyOn(bcrypt, "compare").mockResolvedValueOnce(true as never);

    const result = await login(
      { email: "student@example.com", password: "Password@1" },
      undefined,
      existingToken
    );

    expect(result.sessionReplaced).toBe(false);
  });

  it("reports sessionReplaced=false when the previous session already expired", async () => {
    const user = buildStudent({
      passwordHash: "hashed-password",
      activeSessionId: SID,
    });
    user.refreshSessions = [
      buildSession("expired-token", { expiresAt: new Date(Date.now() - 60_000) }),
    ];

    vi.spyOn(UserModel, "findOne").mockResolvedValueOnce(user as never);
    vi.spyOn(bcrypt, "compare").mockResolvedValueOnce(true as never);

    const result = await login({ email: "student@example.com", password: "Password@1" });

    expect(result.sessionReplaced).toBe(false);
  });
});

describe("refresh token rotation", () => {
  it("issues new access AND rotated refresh tokens when tokenVersion matches (FIX-04)", async () => {
    const user = buildStudent({ tokenVersion: 2, activeSessionId: SID });
    const token = signRefreshToken(user, SID);
    user.refreshSessions = [buildSession(token)];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);
    const updateSpy = mockUpdateMatched();

    const result = await refresh(token);

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect((jwt.decode(result.accessToken) as { sid: string }).sid).toBe(SID);
    expect((jwt.decode(result.refreshToken) as { sid: string }).sid).toBe(SID);

    const [filter, update] = updateSpy.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(filter.activeSessionId).toBe(SID);
    expect(update.$set["refreshSessions.$.tokenHash"]).toBe(
      hashRefreshToken(result.refreshToken)
    );
    const consumed = update.$set["refreshSessions.$.consumedTokenHashes"] as Array<{
      tokenHash: string;
    }>;
    expect(consumed.map((entry) => entry.tokenHash)).toContain(hashRefreshToken(token));
    expect(user.save).not.toHaveBeenCalled();
  });

  it("rejects a refresh token after the password change bumped tokenVersion", async () => {
    const user = buildStudent({ tokenVersion: 0, activeSessionId: SID });
    const token = signRefreshToken(user, SID);
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(
      buildStudent({ tokenVersion: 1, activeSessionId: SID }) as never
    );

    await expect(refresh(token)).rejects.toThrow(UnauthorizedError);
  });

  it("rejects a legacy token without the claim when the user bumped tokenVersion", async () => {
    const legacyUser = buildStudent({
      _id: new mongoose.Types.ObjectId("66e85d1c262f3b9200000003"),
      email: "legacy@example.com",
    });
    const token = signRefreshToken(legacyUser, SID);
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(
      buildStudent({ tokenVersion: 1 }) as never
    );

    await expect(refresh(token)).rejects.toThrow(UnauthorizedError);
  });

  it("rotates a just-consumed token within the grace window (I-1 multi-tab race)", async () => {
    const user = buildStudent({ activeSessionId: SID });
    const token = signRefreshToken(user, SID);
    user.refreshSessions = [
      buildSession("newer-rotated-hash", {
        // The other tab rotated this exact token a moment ago.
        consumedTokenHashes: [{ tokenHash: hashRefreshToken(token), rotatedAt: new Date() }],
      }),
    ];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);
    const updateSpy = mockUpdateMatched();

    const result = await refresh(token);

    expect(result.accessToken).toBeDefined();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect((jwt.decode(result.refreshToken) as { sid: string }).sid).toBe(SID);
    expect(user.tokenVersion).toBe(0);
  });

  it("resets the old device with SESSION_REPLACED when its session is no longer active", async () => {
    const user = buildStudent({ activeSessionId: "new-session" });
    const oldToken = signRefreshToken(user, "old-session");
    user.refreshSessions = [
      buildSession(oldToken, { sessionId: "old-session" }),
      buildSession("new-hash", { sessionId: "new-session" }),
    ];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);
    const updateSpy = mockUpdateMatched();

    await expect(refresh(oldToken)).rejects.toMatchObject({
      errorCode: "SESSION_REPLACED",
    });

    // The new device's session must not be touched.
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("answers SESSION_REPLACED for an unknown hash while another session is active", async () => {
    const user = buildStudent({ activeSessionId: "new-session" });
    const token = signRefreshToken(user, "old-session");
    user.refreshSessions = [buildSession("new-hash", { sessionId: "new-session" })];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);

    await expect(refresh(token)).rejects.toMatchObject({
      errorCode: "SESSION_REPLACED",
    });
  });

  it("answers a clean 401 for unknown sessions without revoking other devices (I-1 pruned/logged-out)", async () => {
    const user = buildStudent({ activeSessionId: undefined });
    const token = signRefreshToken(user, SID);
    user.refreshSessions = [buildSession("some-other-device-session")];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);
    const updateSpy = mockUpdateMatched();

    await expect(refresh(token)).rejects.toThrow(UnauthorizedError);

    // The unrelated device session must survive and tokenVersion is untouched.
    expect(user.tokenVersion).toBe(0);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("prunes an expired session with a clean 401, without revoking the user (I-1 7-day window)", async () => {
    const user = buildStudent({ activeSessionId: SID });
    const token = signRefreshToken(user, SID);
    user.refreshSessions = [
      buildSession(token, {
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 60_000),
      }),
    ];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);
    const updateSpy = mockUpdateMatched();

    await expect(refresh(token)).rejects.toThrow(UnauthorizedError);

    expect(user.tokenVersion).toBe(0);
    expect(updateSpy.mock.calls[0][1]).toMatchObject({
      $pull: { refreshSessions: { sessionId: SID } },
    });
  });

  it("detects a true replay (long-consumed token) and revokes every session (I-1)", async () => {
    const user = buildStudent({ activeSessionId: SID });
    const token = signRefreshToken(user, SID);
    user.refreshSessions = [
      buildSession("current-rotated-hash", {
        consumedTokenHashes: [
          { tokenHash: hashRefreshToken(token), rotatedAt: new Date(Date.now() - 10 * 60 * 1000) },
        ],
      }),
    ];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);
    const updateSpy = mockUpdateMatched();

    await expect(refresh(token)).rejects.toThrow(UnauthorizedError);

    const update = updateSpy.mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(update.$set).toEqual({ refreshSessions: [] });
    expect(update.$inc).toEqual({ tokenVersion: 1 });
    expect(update.$unset).toEqual({ activeSessionId: 1 });
  });

  it("upgrades a legacy session without sessionId on first refresh", async () => {
    const user = buildStudent({ activeSessionId: undefined });
    const token = signRefreshToken(user, SID);
    user.refreshSessions = [
      {
        tokenHash: hashRefreshToken(token),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        consumedTokenHashes: [],
      },
    ];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);
    const updateSpy = mockUpdateMatched();

    const result = await refresh(token);
    const newSid = (jwt.decode(result.accessToken) as { sid: string }).sid;

    const update = updateSpy.mock.calls[0][1] as unknown as {
      $set: { refreshSessions: IRefreshSession[]; activeSessionId: string };
    };
    expect(update.$set.activeSessionId).toBe(newSid);
    expect(update.$set.refreshSessions).toHaveLength(1);
    expect(update.$set.refreshSessions[0].sessionId).toBe(newSid);
    expect(update.$set.refreshSessions[0].tokenHash).toBe(
      hashRefreshToken(result.refreshToken)
    );
  });

  it("rejects a legacy refresh token that lacks the `type` discriminator (FIX-20)", async () => {
    const legacyToken = jwt.sign(
      {
        sub: "66e85d1c262f3b9200000002",
        role: "student",
        email: "student@example.com",
        tokenVersion: 0,
      },
      env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    await expect(refresh(legacyToken)).rejects.toThrow(UnauthorizedError);
  });
});

describe("logout session revocation (FIX-04)", () => {
  it("removes the matching active session server-side", async () => {
    const user = buildStudent({ activeSessionId: SID });
    const token = signRefreshToken(user, SID);
    user.refreshSessions = [buildSession(token)];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);
    const updateSpy = mockUpdateMatched();

    await logout(token);

    const [, update] = updateSpy.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(update.$pull).toEqual({ refreshSessions: { tokenHash: hashRefreshToken(token) } });
    expect(update.$unset).toEqual({ activeSessionId: 1 });
  });

  it("does not clear a newer active session when an old device logs out", async () => {
    const user = buildStudent({ activeSessionId: "new-session" });
    const oldToken = signRefreshToken(user, "old-session");
    user.refreshSessions = [buildSession(oldToken, { sessionId: "old-session" })];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);
    const updateSpy = mockUpdateMatched();

    await logout(oldToken);

    const [, update] = updateSpy.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(update.$unset).toBeUndefined();
  });

  it("is idempotent for missing or unparseable tokens", async () => {
    await expect(logout(undefined)).resolves.toBeUndefined();
    await expect(logout("not-a-jwt")).resolves.toBeUndefined();
  });
});
