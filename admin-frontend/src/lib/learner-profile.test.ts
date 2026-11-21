import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveLearnerNickname, uploadLearnerAvatar, validateAvatar } from "./learner-profile";
import { apiRequest } from "@/lib/api/client";

vi.mock("@/lib/api/client", () => ({ apiRequest: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("learner profile contract", () => {
  it("normalizes nickname and updates the current user through the user domain", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ id: 7, nickname: "新 昵称" });
    const response = await saveLearnerNickname("  新   昵称  ");
    expect(apiRequest).toHaveBeenCalledWith("/users/me", expect.objectContaining({
      method: "PUT", scope: "user", body: JSON.stringify({ nickname: "新 昵称" }),
    }));
    expect(response.nickname).toBe("新 昵称");
  });

  it.each(["   ", "学".repeat(65)])("rejects invalid nickname without a request", async (nickname) => {
    await expect(saveLearnerNickname(nickname)).rejects.toThrow();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("counts supplementary characters the same way as the server", async () => {
    const nickname = "😀".repeat(64);
    await saveLearnerNickname(nickname);
    expect(apiRequest).toHaveBeenCalledWith("/users/me", expect.objectContaining({ body: JSON.stringify({ nickname }) }));
    vi.clearAllMocks();
    await expect(saveLearnerNickname(`${nickname}😀`)).rejects.toThrow("昵称不能超过 64 个字符");
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("uploads the avatar as multipart file without a client-provided content type", async () => {
    const file = new File(["fixture"], "avatar.png", { type: "image/png" });
    await uploadLearnerAvatar(file);
    const [path, options] = vi.mocked(apiRequest).mock.calls[0];
    expect(path).toBe("/users/me/avatar");
    expect(options).toMatchObject({ method: "POST", scope: "user" });
    expect(options?.headers).toBeUndefined();
    expect((options?.body as FormData).get("file")).toBe(file);
  });

  it.each([
    new File(["svg"], "avatar.svg", { type: "image/svg+xml" }),
    new File([], "empty.png", { type: "image/png" }),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
  ])("rejects unsupported, empty and oversized avatars before sending", async (file) => {
    expect(validateAvatar(file)).toBeTruthy();
    await expect(uploadLearnerAvatar(file)).rejects.toThrow();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("propagates a failed save so the form can preserve the draft", async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error("unavailable"));
    await expect(saveLearnerNickname("草稿")).rejects.toThrow("unavailable");
  });
});
