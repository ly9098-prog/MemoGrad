import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountSettingsPage from "./page";

const harness = vi.hoisted(() => ({
  request: vi.fn(),
  identities: [] as {
    id: number;
    provider: string;
    masked_subject: string;
    verified: boolean;
  }[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/api/client", () => ({ apiRequest: harness.request }));
vi.mock("@/lib/auth/auth-store", () => ({
  useAuthStore: (select: (state: unknown) => unknown) => select({
    accessMode: "user",
    learnerUser: { id: 7, identities: harness.identities, email: "learner@example.com" },
    accessToken: "fixture-access",
    acceptLearnerLogin: vi.fn(),
    clear: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  harness.identities = [];
});

describe("Web identity management", () => {
  it("keeps email and GitHub actions without offering the retired WeChat flow", () => {
    const markup = renderToStaticMarkup(createElement(AccountSettingsPage));

    expect(markup).toContain("绑定邮箱");
    expect(markup).toContain("绑定 GitHub");
    expect(markup).not.toMatch(/绑定微信|小程序码|绑定码|小程序确认/);
  });

  it("still displays an existing WeChat identity without a new binding action", () => {
    harness.identities = [{ id: 3, provider: "wechat", masked_subject: "wx***", verified: true }];

    const markup = renderToStaticMarkup(createElement(AccountSettingsPage));

    expect(markup).toContain("微信");
    expect(markup).not.toMatch(/绑定微信|小程序确认/);
  });
});
