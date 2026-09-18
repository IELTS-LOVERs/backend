import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { env } from "../../config/env.js";
import { UserModel, type IUser } from "../users/user.model.js";
import { generateTokens, refresh, signAccessToken, signRefreshToken } from "./auth.service.js";

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
    } as unknown as IUser;
  }

  it("issues a new access token when tokenVersion matches", async () => {
    const user = buildUser(2);
    const token = signRefreshToken(user);
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(user as never);

    const result = await refresh(token);
    expect(result.accessToken).toBeDefined();
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
    } as unknown as IUser;
    const token = signRefreshToken(legacyUser);
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(buildUser(1) as never);

    await expect(refresh(token)).rejects.toThrow(UnauthorizedError);
  });
});
