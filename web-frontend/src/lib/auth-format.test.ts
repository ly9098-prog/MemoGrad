import { describe, expect, it } from "vitest";
import { accountInitial, accountName, identityDescription } from "./auth-format";
import type { User } from "./types";

const user: User = {
  id: 42,
  nickname: null,
  avatar_url: null,
  profile_completed: false,
  email: "reader@example.com",
  email_verified: true,
  identities: [],
  is_admin: false,
  role: "user",
  role_name: "user",
  permissions: [],
};

describe("account presentation", () => {
  it("uses the verified email as the stable fallback name", () => {
    expect(accountName(user)).toBe("reader@example.com");
    expect(accountInitial(user)).toBe("R");
  });

  it("shows the full local email while keeping provider labels human-readable", () => {
    expect(identityDescription({
      id: 1,
      provider: "email",
      namespace: "user",
      masked_subject: "re***@example.com",
      verified: true,
    }, user)).toBe("reader@example.com");
  });
});
