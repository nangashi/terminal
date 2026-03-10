import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  writeText as clipboardWrite,
  readText as clipboardRead,
} from "@tauri-apps/plugin-clipboard-manager";
import "@xterm/xterm/css/xterm.css";
import "./TerminalView.css";

export interface TerminalHandle {
  write: (data: string) => void;
  fit: () => void;
  terminal: Terminal | null;
}

interface TerminalViewProps {
  isActive?: boolean;
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onTitleChange?: (title: string) => void;
}

const TERMINAL_CONTAINER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  overflow: "hidden",
  padding: "4px 8px",
};

export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(
  function TerminalView({ isActive, onData, onResize, onTitleChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const isActiveRef = useRef(isActive);
    isActiveRef.current = isActive;

    // Keep callback refs so the xterm event handlers always call the latest version
    const onDataRef = useRef(onData);
    onDataRef.current = onData;
    const onResizeRef = useRef(onResize);
    onResizeRef.current = onResize;
    const onTitleChangeRef = useRef(onTitleChange);
    onTitleChangeRef.current = onTitleChange;

    useImperativeHandle(ref, () => ({
      write: (data: string) => {
        terminalRef.current?.write(data);
      },
      fit: () => {
        fitAddonRef.current?.fit();
      },
      get terminal() {
        return terminalRef.current;
      },
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const style = getComputedStyle(document.documentElement);
      const cssVar = (name: string) => style.getPropertyValue(name).trim();

      const terminal = new Terminal({
        allowProposedApi: true,
        fontSize: 14,
        fontFamily:
          '"HackGen35 Console NF", "Cascadia Code", "JetBrains Mono", "DejaVu Sans Mono", Menlo, monospace',
        cursorBlink: true,
        theme: {
          background: cssVar("--color-base"),
          foreground: cssVar("--color-text"),
          cursor: cssVar("--color-cursor"),
        },
      });

      const unicodeAddon = new Unicode11Addon();
      terminal.loadAddon(unicodeAddon);
      terminal.unicode.activeVersion = "11";

      const fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;
      terminal.loadAddon(fitAddon);
      terminal.open(container);

      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => webglAddon.dispose());
        terminal.loadAddon(webglAddon);
      } catch {
        // WebGL2 unavailable — falls back to default canvas renderer
      }

      fitAddon.fit();

      // Workaround: xterm.js v6 does not support the CSI u (kitty) keyboard
      // protocol, so Ctrl+Enter is indistinguishable from Enter.  We intercept
      // Ctrl+Enter here and manually emit the CSI u sequence so that TUI apps
      // like Claude Code can recognise it as a newline insertion.
      // TODO: Remove once xterm.js v7 is released with vtExtensions.kittyKeyboard support.
      terminal.attachCustomKeyEventHandler((e) => {
        if (e.type === "keydown" && e.key === "Enter" && e.ctrlKey) {
          // CSI u encoding: CSI keycode ; modifiers u
          // Enter = 13, Ctrl modifier = 5
          onDataRef.current?.("\x1b[13;5u");
          return false;
        }
        return true;
      });

      terminal.onData((data) => {
        onDataRef.current?.(data);
      });

      terminal.onResize(({ cols, rows }) => {
        onResizeRef.current?.(cols, rows);
      });

      terminal.onTitleChange((title) => {
        onTitleChangeRef.current?.(title);
      });

      // Right-click: copy selection or paste (Windows Terminal behavior)
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        const selection = terminal.getSelection();
        if (selection) {
          clipboardWrite(selection);
          terminal.clearSelection();
        } else {
          clipboardRead().then((text) => {
            onDataRef.current?.(text);
          });
        }
      };
      container.addEventListener("contextmenu", handleContextMenu);

      // Lock IME composition position so it doesn't jump during terminal output.
      //
      // xterm.js syncs the hidden textarea to the terminal cursor on every
      // cursor move (_syncTextArea).  TUI apps like Claude Code move the cursor
      // around to render UI elements (status bars, etc.), which drags the
      // textarea along.  If the user starts IME composition at that point the
      // candidate window appears at the wrong position.
      //
      // To mitigate this we record the textarea position after a short delay
      // following each non-IME keystroke.  The delay (50ms) allows the PTY
      // round-trip and TUI re-render to complete, so the captured position
      // reflects where the cursor settled after the TUI processed the input
      // — not where it was during rendering.
      const textarea = container.querySelector<HTMLTextAreaElement>(
        ".xterm-helper-textarea",
      );
      const compositionView =
        container.querySelector<HTMLElement>(".composition-view");

      // Viewport-relative coords (for textarea with position: fixed)
      let imeAnchorViewport: { left: number; top: number } | null = null;
      // Container-relative coords (for compositionView with position: absolute)
      let imeAnchorLocal: { left: string; top: string } | null = null;
      let imeAnchorTimer: ReturnType<typeof setTimeout> | undefined;
      let isComposing = false;

      const captureImeAnchor = () => {
        if (textarea) {
          const rect = textarea.getBoundingClientRect();
          imeAnchorViewport = { left: rect.left, top: rect.top };
          imeAnchorLocal = {
            left: textarea.style.left,
            top: textarea.style.top,
          };
        }
      };

      const scheduleCapture = () => {
        if (!isComposing) {
          clearTimeout(imeAnchorTimer);
          imeAnchorTimer = setTimeout(captureImeAnchor, 50);
        }
      };

      const trackImeAnchor = (e: KeyboardEvent) => {
        // keyCode 229 = IME composition character; skip to avoid capturing
        // the cursor position that TUI rendering may have moved to.
        if (e.keyCode !== 229) {
          scheduleCapture();
        }
      };

      // Track cursor movement so the IME anchor updates even without
      // non-IME keystrokes (e.g. after confirming Japanese text, clicking,
      // or terminal output moving the cursor).
      terminal.onCursorMove(scheduleCapture);

      const lockImePosition = () => {
        isComposing = true;
        // Stop any pending capture — the anchor must stay stable during
        // composition.
        clearTimeout(imeAnchorTimer);

        if (textarea) {
          const pos =
            imeAnchorViewport ??
            (() => {
              const r = textarea.getBoundingClientRect();
              return { left: r.left, top: r.top };
            })();
          textarea.style.setProperty("--ime-lock-left", `${pos.left}px`);
          textarea.style.setProperty("--ime-lock-top", `${pos.top}px`);
          textarea.classList.add("ime-composing");
          // Match the terminal font so the IME system calculates character
          // positions correctly.  xterm.js only sets font on composition-view,
          // leaving the textarea in the browser's default (proportional) font.
          // The width mismatch causes the candidate window to drift.
          const opts = terminal.options;
          textarea.style.fontFamily = opts.fontFamily ?? "";
          textarea.style.fontSize = `${opts.fontSize ?? 14}px`;
        }
        if (compositionView) {
          const pos = imeAnchorLocal ?? {
            left: compositionView.style.left,
            top: compositionView.style.top,
          };
          compositionView.style.setProperty("--ime-lock-left", pos.left);
          compositionView.style.setProperty("--ime-lock-top", pos.top);
          compositionView.classList.add("ime-composing");

          // Constrain width so composition text wraps within the pane
          const parent = compositionView.offsetParent as HTMLElement | null;
          if (parent) {
            const leftPx = parseFloat(pos.left) || 0;
            const maxW = parent.clientWidth - leftPx;
            compositionView.style.maxWidth = `${Math.max(maxW, 0)}px`;
          }
        }
      };

      const unlockImePosition = () => {
        isComposing = false;
        textarea?.classList.remove("ime-composing");
        compositionView?.classList.remove("ime-composing");
        compositionView?.style.removeProperty("max-width");
        if (textarea) {
          textarea.style.fontFamily = "";
          textarea.style.fontSize = "";
        }
        // Recapture after composition ends so the next composition
        // starts at the updated cursor position.
        scheduleCapture();
      };

      textarea?.addEventListener("keydown", trackImeAnchor);
      textarea?.addEventListener("compositionstart", lockImePosition);
      textarea?.addEventListener("compositionend", unlockImePosition);
      textarea?.addEventListener("blur", unlockImePosition);

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(container);

      terminalRef.current = terminal;

      return () => {
        clearTimeout(imeAnchorTimer);
        textarea?.removeEventListener("keydown", trackImeAnchor);
        textarea?.removeEventListener("compositionstart", lockImePosition);
        textarea?.removeEventListener("compositionend", unlockImePosition);
        textarea?.removeEventListener("blur", unlockImePosition);
        container.removeEventListener("contextmenu", handleContextMenu);
        resizeObserver.disconnect();
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
      };
    }, []);

    useEffect(() => {
      if (isActive && terminalRef.current) {
        terminalRef.current.focus();
      }
    }, [isActive]);

    return <div ref={containerRef} style={TERMINAL_CONTAINER_STYLE} />;
  },
);
