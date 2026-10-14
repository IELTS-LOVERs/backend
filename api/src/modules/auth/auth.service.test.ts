import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { env } from "../../config/env.js";
import { UserModel, type IUser } from "../users/user.model.js";
import { generateTokens, hashRefreshToken, logout, refresh, signAccessToken, signRefreshToken } from "./auth.service.js";

describe("auth.service token utilities", () => {
  const mockUser = {
    _id: new mongoose.Types.ObjectId("66e85d1c262f3b9200000001"),
    email: "student@example.com",
    role: "student",
  } as unknown as IUser;

  it("generates a valid signed access token", () => {
    const token = signAccessToken(mockUser);
    expect(token).toBeDefined();

    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
      sub: string;
      role: string;
      email: string;
    };

    expect(decoded.sub).toBe("66e85d1c262f3b9200000001");
    expect(decoded.email).toBe("student@example.com");
    expect(decoded.role).toBe("student");
  });

  it("generates a valid signed refresh token", () => {
    const token = signRefreshToken(mockUser);
    expect(token).toBeDefined();

    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as {
      sub: string;
      role: string;
      email: string;
    };

    expect(decoded.sub).toBe("66e85d1c262f3b9200000001");
    expect(decoded.email).toBe("student@example.com");
    expect(decoded.role).toBe("student");
  });

  it("generates both access and refresh tokens via generateTokens", () => {
    const tokens = generateTokens(mockUser);

    expect(tokens.accessToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();

    const accessDecoded = jwt.verify(tokens.accessToken, env.JWT_ACCESS_SECRET) as { sub: string };
    const refreshDecoded = jwt.verify(tokens.refreshToken, env.JWT_REFRESH_SECRET) as { sub: string };

    expect(accessDecoded.sub).toBe("66e85d1c262f3b9200000001");
    expect(refreshDecoded.sub).toBe("66e85d1c262f3b9200000001");
  });
});

describe("refresh token version revocation", () => {
  function buildUser(tokenVersion?: number): IUser {
    return {
      _id: new mongoose.Types.ObjectId("66e85d1c262f3b9200000002"),
      email: "student@example.com",
      role: "student",
      status: "active",
      tokenVersion,
      refreshSessions: [],
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as IUser;
  }

  it("issues new access AND rotated refresh tokens when tokenVersion matches (FIX-04)", async () => {
    const user = buildUser(2);
    const token = signRefreshToken(user);
    user.refreshSessions = [
      {
        tokenHash: hashRefreshToken(token),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        consumedTokenHashes: [],
      },
    ];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);

    const result = await refresh(token);
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    // The stored session must have rotated to the new token hash.
    expect(user.refreshSessions[0].tokenHash).toBe(hashRefreshToken(result.refreshToken));
    expect(user.refreshSessions[0].tokenHash).not.toBe(hashRefreshToken(token));
    // I-1: the consumed hash is remembered for benign-race detection.
    expect(user.refreshSessions[0].consumedTokenHashes.map((entry) => entry.tokenHash)).toContain(
      hashRefreshToken(token)
    );
    expect(user.save).toHaveBeenCalled();
  });

  it("rejects a refresh token after the password change bumped tokenVersion", async () => {
    const user = buildUser(0);
    const token = signRefreshToken(user);
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(buildUser(1) as never);

    await expect(refresh(token)).rejects.toThrow(UnauthorizedError);
  });

  it("rejects a legacy token without the claim when the user bumped tokenVersion", async () => {
    const legacyUser = {
      _id: new mongoose.Types.ObjectId("66e85d1c262f3b9200000003"),
      email: "legacy@example.com",
      role: "student",
      status: "active",
      refreshSessions: [],
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as IUser;
    const token = signRefreshToken(legacyUser);
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(buildUser(1) as never);

    await expect(refresh(token)).rejects.toThrow(UnauthorizedError);
  });

  it("rotates a just-consumed token within the grace window (I-1 multi-tab race)", async () => {
    const user = buildUser(0);
    const token = signRefreshToken(user);
    user.refreshSessions = [
      {
        tokenHash: "newer-rotated-hash",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        // The other tab rotated this exact token a moment ago.
        consumedTokenHashes: [{ tokenHash: hashRefreshToken(token), rotatedAt: new Date() }],
      },
    ];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);

    const result = await refresh(token);

    expect(result.accessToken).toBeDefined();
    expect(user.refreshSessions).toHaveLength(1);
    expect(user.refreshSessions[0].tokenHash).toBe(hashRefreshToken(result.refreshToken));
    // No global revocation for a benign race.
    expect(user.tokenVersion).toBe(0);
  });

  it("answers a clean 401 for unknown sessions without revoking other devices (I-1 pruned/logged-out)", async () => {
    const user = buildUser(0);
    const token = signRefreshToken(user);
    user.refreshSessions = [
      {
        tokenHash: "some-other-device-session",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        consumedTokenHashes: [],
      },
    ];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);

    await expect(refresh(token)).rejects.toThrow(UnauthorizedError);

    // The unrelated device session must survive and tokenVersion is untouched.
    expect(user.refreshSessions).toHaveLength(1);
    expect(user.tokenVersion).toBe(0);
  });

  it("prunes an expired session with a clean 401, without revoking the user (I-1 7-day window)", async () => {
    const user = buildUser(0);
    const token = signRefreshToken(user);
    user.refreshSessions = [
      {
        tokenHash: hashRefreshToken(token),
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 60_000),
        consumedTokenHashes: [],
      },
    ];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);

    await expect(refresh(token)).rejects.toThrow(UnauthorizedError);

    expect(user.refreshSessions).toHaveLength(0);
    expect(user.tokenVersion).toBe(0);
    expect(user.save).toHaveBeenCalled();
  });

  it("detects a true replay (long-consumed token) and revokes every session (I-1)", async () => {
    const user = buildUser(0);
    const token = signRefreshToken(user);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    user.refreshSessions = [
      {
        tokenHash: "current-rotated-hash",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        consumedTokenHashes: [{ tokenHash: hashRefreshToken(token), rotatedAt: tenMinutesAgo }],
      },
    ];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);

    await expect(refresh(token)).rejects.toThrow(UnauthorizedError);
    expect(user.refreshSessions).toEqual([]);
    expect(user.tokenVersion).toBe(1);
    expect(user.save).toHaveBeenCalled();
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
  function buildUser(): IUser {
    return {
      _id: new mongoose.Types.ObjectId("66e85d1c262f3b9200000004"),
      email: "student@example.com",
      role: "student",
      status: "active",
      tokenVersion: 0,
      refreshSessions: [],
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as IUser;
  }

  it("removes the matching session server-side", async () => {
    const user = buildUser();
    const token = signRefreshToken(user);
    user.refreshSessions = [
      {
        tokenHash: hashRefreshToken(token),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        consumedTokenHashes: [],
      },
    ];
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);

    await logout(token);

    expect(user.refreshSessions).toHaveLength(0);
    expect(user.save).toHaveBeenCalled();
  });

  it("is idempotent for missing or unparseable tokens", async () => {
    await expect(logout(undefined)).resolves.toBeUndefined();
    await expect(logout("not-a-jwt")).resolves.toBeUndefined();
  });
});
