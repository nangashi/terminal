import { useEffect, useRef, useState, useCallback } from "react";

export type PrefixAction =
  | "split-horizontal"
  | "split-vertical"
  | "navigate-left"
  | "navigate-down"
  | "navigate-up"
  | "navigate-right"
  | "resize-left"
  | "resize-down"
  | "resize-up"
  | "resize-right"
  | "close-pane"
  | "toggle-sidebar"
  | "create-window"
  | "next-window"
  | "prev-window"
  | "select-pane-1"
  | "select-pane-2"
  | "select-pane-3"
  | "select-pane-4"
  | "select-pane-5"
  | "select-pane-6"
  | "select-pane-7"
  | "select-pane-8"
  | "select-pane-9"
  | "cancel";

const PREFIX_TIMEOUT_MS = 2000;

function resolveAction(key: string): PrefixAction {
  switch (key) {
    case "-":
      return "split-horizontal";
    case "|":
      return "split-vertical";
    case "h":
    case "ArrowLeft":
      return "navigate-left";
    case "j":
    case "ArrowDown":
      return "navigate-down";
    case "k":
    case "ArrowUp":
      return "navigate-up";
    case "l":
    case "ArrowRight":
      return "navigate-right";
    case "H":
      return "resize-left";
    case "J":
      return "resize-down";
    case "K":
      return "resize-up";
    case "L":
      return "resize-right";
    case "x":
      return "close-pane";
    case "b":
      return "toggle-sidebar";
    case "c":
      return "create-window";
    case "n":
      return "next-window";
    case "p":
      return "prev-window";
    case "1":
      return "select-pane-1";
    case "2":
      return "select-pane-2";
    case "3":
      return "select-pane-3";
    case "4":
      return "select-pane-4";
    case "5":
      return "select-pane-5";
    case "6":
      return "select-pane-6";
    case "7":
      return "select-pane-7";
    case "8":
      return "select-pane-8";
    case "9":
      return "select-pane-9";
    default:
      return "cancel";
  }
}

export function usePrefixKey(onAction: (action: PrefixAction) => void) {
  const [isPrefixMode, setIsPrefixMode] = useState(false);
  const isPrefixModeRef = useRef(false);
  const onActionRef = useRef(onAction);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onActionRef.current = onAction;
  });

  const clearTimeout_ = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const exitPrefixMode = useCallback(() => {
    isPrefixModeRef.current = false;
    setIsPrefixMode(false);
    clearTimeout_();
  }, [clearTimeout_]);

  const enterPrefixMode = useCallback(() => {
    isPrefixModeRef.current = true;
    setIsPrefixMode(true);
    clearTimeout_();
    timeoutRef.current = setTimeout(() => {
      exitPrefixMode();
    }, PREFIX_TIMEOUT_MS);
  }, [clearTimeout_, exitPrefixMode]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isPrefixModeRef.current) {
        // Enter prefix mode on Ctrl+T
        if (e.ctrlKey && e.key === "t") {
          e.preventDefault();
          e.stopPropagation();
          enterPrefixMode();
        }
        return;
      }

      // Ignore modifier-only keys (Shift, Control, Alt, Meta)
      if (
        e.key === "Shift" ||
        e.key === "Control" ||
        e.key === "Alt" ||
        e.key === "Meta"
      ) {
        return;
      }

      // In prefix mode - interpret the next key
      e.preventDefault();
      e.stopPropagation();

      const action = resolveAction(e.key);
      exitPrefixMode();
      onActionRef.current(action);
    }

    // Capture phase to intercept before xterm.js
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      clearTimeout_();
    };
  }, [enterPrefixMode, exitPrefixMode, clearTimeout_]);

  return { isPrefixMode };
}
