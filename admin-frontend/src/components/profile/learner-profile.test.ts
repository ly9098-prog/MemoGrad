import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearnerUser } from "@/lib/api/types";
import { LearnerProfile } from "./learner-profile";

const harness = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  current: {} as { accessMode: string | null; learnerUser: unknown },
  updateStore: vi.fn(),
  save: vi.fn(),
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => (() => void) | undefined) => {
    const cleanup = effect();
    if (cleanup) harness.effects.push(cleanup);
  },
}));
vi.mock("@/lib/auth/auth-store", () => ({
  useAuthStore: { getState: () => harness.current, setState: harness.updateStore },
}));
vi.mock("@/lib/learner-profile", () => ({
  saveLearnerNickname: harness.save,
  uploadLearnerAvatar: vi.fn(),
  validateAvatar: vi.fn(),
}));

const user: LearnerUser = {
  id: 7, nickname: "原昵称", profile_completed: true, email_verified: true,
  identities: [], is_admin: false, role: "user", role_name: "user", permissions: [],
};

function findForm(node: unknown): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) return node.map(findForm).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (node.type === "form") return node;
  return findForm(node.props.children);
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.effects = [];
  harness.current = { accessMode: "user", learnerUser: user };
});

describe("profile save lifecycle", () => {
  it.each(["same-user", "signed-out", "switched-user"])(
    "finishes an unmounted save only for its original session: %s",
    async (session) => {
      let resolveSave!: (value: LearnerUser) => void;
      harness.save.mockImplementation(() => new Promise<LearnerUser>((resolve) => { resolveSave = resolve; }));
      const form = findForm(LearnerProfile({ user }))!;
      (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
      expect(harness.save).toHaveBeenCalledOnce();
      harness.effects.forEach((cleanup) => cleanup());
      if (session === "signed-out") harness.current = { accessMode: null, learnerUser: null };
      if (session === "switched-user") harness.current = { accessMode: "user", learnerUser: { ...user, id: 8 } };
      const updated = { ...user, nickname: "已保存的昵称" };
      resolveSave(updated);
      await vi.waitFor(() => {
        if (session === "same-user") expect(harness.updateStore).toHaveBeenCalledWith({ learnerUser: updated });
        else expect(harness.updateStore).not.toHaveBeenCalled();
      });
      await Promise.resolve();
      if (session !== "same-user") expect(harness.updateStore).not.toHaveBeenCalled();
    },
  );
});
