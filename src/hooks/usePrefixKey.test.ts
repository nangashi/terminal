import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePrefixKey, PrefixAction } from "./usePrefixKey";

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  document.dispatchEvent(event);
  return event;
}

describe("usePrefixKey", () => {
  let actions: PrefixAction[];
  let onAction: (action: PrefixAction) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    actions = [];
    onAction = (a) => actions.push(a);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enters prefix mode on Ctrl+T", () => {
    const { result } = renderHook(() => usePrefixKey(onAction));
    expect(result.current.isPrefixMode).toBe(false);

    act(() => fireKey("t", { ctrlKey: true }));
    expect(result.current.isPrefixMode).toBe(true);
  });

  it("fires split-horizontal on prefix + -", () => {
    renderHook(() => usePrefixKey(onAction));
    act(() => fireKey("t", { ctrlKey: true }));
    act(() => fireKey("-"));
    expect(actions).toEqual(["split-horizontal"]);
  });

  it("fires split-vertical on prefix + |", () => {
    renderHook(() => usePrefixKey(onAction));
    act(() => fireKey("t", { ctrlKey: true }));
    act(() => fireKey("|"));
    expect(actions).toEqual(["split-vertical"]);
  });

  it("fires navigate actions with hjkl", () => {
    renderHook(() => usePrefixKey(onAction));
    for (const [key] of [
      ["h", "navigate-left"],
      ["j", "navigate-down"],
      ["k", "navigate-up"],
      ["l", "navigate-right"],
    ] as const) {
      act(() => fireKey("t", { ctrlKey: true }));
      act(() => fireKey(key));
    }
    expect(actions).toEqual([
      "navigate-left",
      "navigate-down",
      "navigate-up",
      "navigate-right",
    ]);
  });

  it("fires navigate actions with arrow keys", () => {
    renderHook(() => usePrefixKey(onAction));
    act(() => fireKey("t", { ctrlKey: true }));
    act(() => fireKey("ArrowLeft"));
    expect(actions).toEqual(["navigate-left"]);
  });

  it("fires resize actions with Shift+hjkl", () => {
    renderHook(() => usePrefixKey(onAction));
    for (const [key] of [
      ["H", "resize-left"],
      ["J", "resize-down"],
      ["K", "resize-up"],
      ["L", "resize-right"],
    ] as const) {
      act(() => fireKey("t", { ctrlKey: true }));
      act(() => fireKey(key, { shiftKey: true }));
    }
    expect(actions).toEqual([
      "resize-left",
      "resize-down",
      "resize-up",
      "resize-right",
    ]);
  });

  it("fires close-pane on prefix + x", () => {
    renderHook(() => usePrefixKey(onAction));
    act(() => fireKey("t", { ctrlKey: true }));
    act(() => fireKey("x"));
    expect(actions).toEqual(["close-pane"]);
  });

  it("cancels on Escape", () => {
    const { result } = renderHook(() => usePrefixKey(onAction));
    act(() => fireKey("t", { ctrlKey: true }));
    expect(result.current.isPrefixMode).toBe(true);
    act(() => fireKey("Escape"));
    expect(result.current.isPrefixMode).toBe(false);
    expect(actions).toEqual(["cancel"]);
  });

  it("times out after 2 seconds", () => {
    const { result } = renderHook(() => usePrefixKey(onAction));
    act(() => fireKey("t", { ctrlKey: true }));
    expect(result.current.isPrefixMode).toBe(true);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.isPrefixMode).toBe(false);
  });

  it("exits prefix mode after action", () => {
    const { result } = renderHook(() => usePrefixKey(onAction));
    act(() => fireKey("t", { ctrlKey: true }));
    act(() => fireKey("-"));
    expect(result.current.isPrefixMode).toBe(false);
  });

  it("ignores modifier-only keys in prefix mode", () => {
    const { result } = renderHook(() => usePrefixKey(onAction));
    act(() => fireKey("t", { ctrlKey: true }));
    act(() => fireKey("Shift", { shiftKey: true }));
    expect(result.current.isPrefixMode).toBe(true);
    expect(actions).toEqual([]);
    // Can still perform action after modifier
    act(() => fireKey("|", { shiftKey: true }));
    expect(result.current.isPrefixMode).toBe(false);
    expect(actions).toEqual(["split-vertical"]);
  });
});
