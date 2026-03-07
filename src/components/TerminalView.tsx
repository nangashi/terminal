import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";

export interface TerminalHandle {
  write: (data: string) => void;
  terminal: Terminal | null;
}

interface TerminalViewProps {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(
  function TerminalView({ onData, onResize }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);

    // Keep callback refs so the xterm event handlers always call the latest version
    const onDataRef = useRef(onData);
    onDataRef.current = onData;
    const onResizeRef = useRef(onResize);
    onResizeRef.current = onResize;

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

      const terminal = new Terminal({
        allowProposedApi: true,
        fontSize: 14,
        fontFamily:
          '"HackGen35 Console NF", "Cascadia Code", "JetBrains Mono", "DejaVu Sans Mono", Menlo, monospace',
        cursorBlink: true,
        theme: {
          background: "#1e1e2e",
          foreground: "#cdd6f4",
          cursor: "#f5e0dc",
        },
      });

      const unicodeAddon = new Unicode11Addon();
      terminal.loadAddon(unicodeAddon);
      terminal.unicode.activeVersion = "11";

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      fitAddon.fit();

      terminal.onData((data) => {
        onDataRef.current?.(data);
      });

      terminal.onResize(({ cols, rows }) => {
        onResizeRef.current?.(cols, rows);
      });

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(container);

      terminalRef.current = terminal;

      return () => {
        resizeObserver.disconnect();
        terminal.dispose();
        terminalRef.current = null;
      };
    }, []);

    return (
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", overflow: "hidden" }}
      />
    );
  },
);
