import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useClaudeStatus } from "./useClaudeStatus";

describe("useClaudeStatus", () => {
  it("returns empty map initially", () => {
    const { result } = renderHook(() => useClaudeStatus());
    expect(result.current.claudeStatus.size).toBe(0);
  });

  it("detects working status from title with middle dot", () => {
    const { result } = renderHook(() => useClaudeStatus());
    act(() => {
      result.current.handleTitleChange("pane-1", "claude \u00B7 task");
    });
    expect(result.current.claudeStatus.get("pane-1")?.status).toBe("working");
  });

  it("detects idle status from title with eight-spoked asterisk", () => {
    const { result } = renderHook(() => useClaudeStatus());
    act(() => {
      result.current.handleTitleChange("pane-1", "claude \u2733 waiting");
    });
    expect(result.current.claudeStatus.get("pane-1")?.status).toBe("idle");
  });

  it("removes status when title no longer contains claude", () => {
    const { result } = renderHook(() => useClaudeStatus());
    act(() => {
      result.current.handleTitleChange("pane-1", "claude \u00B7 task");
    });
    expect(result.current.claudeStatus.has("pane-1")).toBe(true);

    act(() => {
      result.current.handleTitleChange("pane-1", "bash");
    });
    expect(result.current.claudeStatus.has("pane-1")).toBe(false);
  });

  it("handles case-insensitive claude detection", () => {
    const { result } = renderHook(() => useClaudeStatus());
    act(() => {
      result.current.handleTitleChange("pane-1", "Claude \u00B7 task");
    });
    expect(result.current.claudeStatus.get("pane-1")?.status).toBe("working");

    act(() => {
      result.current.handleTitleChange("pane-2", "CLAUDE \u2733 idle");
    });
    expect(result.current.claudeStatus.get("pane-2")?.status).toBe("idle");
  });

  it("manages multiple panes independently", () => {
    const { result } = renderHook(() => useClaudeStatus());
    act(() => {
      result.current.handleTitleChange("pane-1", "claude \u00B7 working");
      result.current.handleTitleChange("pane-2", "claude \u2733 idle");
    });
    expect(result.current.claudeStatus.get("pane-1")?.status).toBe("working");
    expect(result.current.claudeStatus.get("pane-2")?.status).toBe("idle");

    act(() => {
      result.current.handleTitleChange("pane-1", "bash");
    });
    expect(result.current.claudeStatus.has("pane-1")).toBe(false);
    expect(result.current.claudeStatus.get("pane-2")?.status).toBe("idle");
  });

  it("removes status on empty title", () => {
    const { result } = renderHook(() => useClaudeStatus());
    act(() => {
      result.current.handleTitleChange("pane-1", "claude \u00B7 task");
    });
    expect(result.current.claudeStatus.has("pane-1")).toBe(true);

    act(() => {
      result.current.handleTitleChange("pane-1", "");
    });
    expect(result.current.claudeStatus.has("pane-1")).toBe(false);
  });
});
