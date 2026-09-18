import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { env } from "../../config/env.js";
import type { IUser } from "../users/user.model.js";
import { generateTokens, signAccessToken, signRefreshToken } from "./auth.service.js";

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
