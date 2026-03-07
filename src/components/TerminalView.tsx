import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

export interface TerminalHandle {
  write: (data: string) => void;
  terminal: Terminal | null;
}

interface TerminalViewProps {
  isActive?: boolean;
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(
  function TerminalView({ isActive, onData, onResize }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const isActiveRef = useRef(isActive);
    isActiveRef.current = isActive;

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

    useEffect(() => {
      if (isActive && terminalRef.current) {
        terminalRef.current.focus();
      }
    }, [isActive]);

    return (
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", overflow: "hidden" }}
      />
    );
  },
);
