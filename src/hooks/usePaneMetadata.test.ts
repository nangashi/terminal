import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePaneMetadata } from "./usePaneMetadata";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

afterEach(() => {
  mockInvoke.mockReset();
});

describe("usePaneMetadata", () => {
  it("returns empty map initially with no entries", () => {
    const { result } = renderHook(() => usePaneMetadata([]));
    expect(result.current.size).toBe(0);
  });

  it("fetches cwd and git info on mount", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_pty_cwd") return Promise.resolve("/home/user/project");
      if (cmd === "get_git_info")
        return Promise.resolve({
          repoName: "project",
          branch: "main",
          isDirty: false,
        });
      return Promise.resolve(null);
    });

    const entries: [string, number][] = [["pane-1", 1]];
    const { result } = renderHook(() => usePaneMetadata(entries));

    await waitFor(() => {
      expect(result.current.get("pane-1")).toBeDefined();
    });

    const meta = result.current.get("pane-1")!;
    expect(meta.cwd).toBe("/home/user/project");
    expect(meta.git?.repoName).toBe("project");
    expect(meta.git?.branch).toBe("main");
  });

  it("handles cwd fetch failure gracefully", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_pty_cwd") return Promise.reject(new Error("PTY exited"));
      return Promise.resolve(null);
    });

    const entries: [string, number][] = [["pane-1", 1]];
    const { result } = renderHook(() => usePaneMetadata(entries));

    await waitFor(() => {
      expect(result.current.get("pane-1")).toBeDefined();
    });

    const meta = result.current.get("pane-1")!;
    expect(meta.cwd).toBeNull();
    expect(meta.git).toBeNull();
  });

  it("skips git info when cwd is null", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_pty_cwd") return Promise.reject(new Error("no cwd"));
      if (cmd === "get_git_info")
        return Promise.resolve({
          repoName: "x",
          branch: "main",
          isDirty: false,
        });
      return Promise.resolve(null);
    });

    const entries: [string, number][] = [["pane-1", 1]];
    renderHook(() => usePaneMetadata(entries));

    // Wait for the initial poll to complete
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_pty_cwd", { id: 1 });
    });

    const gitCalls = mockInvoke.mock.calls.filter(
      (args: unknown[]) => args[0] === "get_git_info",
    );
    expect(gitCalls).toHaveLength(0);
  });

  it("cleans up timer on unmount", () => {
    mockInvoke.mockResolvedValue(null);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    const entries: [string, number][] = [["pane-1", 1]];
    const { unmount } = renderHook(() => usePaneMetadata(entries));

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});
