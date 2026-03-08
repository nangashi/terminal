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

      // Lock IME composition position so it doesn't jump during terminal output
      const textarea = container.querySelector<HTMLTextAreaElement>(
        ".xterm-helper-textarea",
      );
      const compositionView =
        container.querySelector<HTMLElement>(".composition-view");

      const lockImePosition = () => {
        if (textarea) {
          const rect = textarea.getBoundingClientRect();
          textarea.style.setProperty("--ime-lock-left", `${rect.left}px`);
          textarea.style.setProperty("--ime-lock-top", `${rect.top}px`);
          textarea.classList.add("ime-composing");
        }
        if (compositionView) {
          compositionView.style.setProperty(
            "--ime-lock-left",
            compositionView.style.left,
          );
          compositionView.style.setProperty(
            "--ime-lock-top",
            compositionView.style.top,
          );
          compositionView.classList.add("ime-composing");
        }
      };

      const unlockImePosition = () => {
        textarea?.classList.remove("ime-composing");
        compositionView?.classList.remove("ime-composing");
      };

      textarea?.addEventListener("compositionstart", lockImePosition);
      textarea?.addEventListener("compositionend", unlockImePosition);
      textarea?.addEventListener("blur", unlockImePosition);

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(container);

      terminalRef.current = terminal;

      return () => {
        textarea?.removeEventListener("compositionstart", lockImePosition);
        textarea?.removeEventListener("compositionend", unlockImePosition);
        textarea?.removeEventListener("blur", unlockImePosition);
        container.removeEventListener("contextmenu", handleContextMenu);
        resizeObserver.disconnect();
        terminal.dispose();
        terminalRef.current = null;
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
