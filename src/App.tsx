import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TerminalView, TerminalHandle } from "./components/TerminalView";
import "./App.css";

interface PtyOutput {
  id: number;
  data: number[];
}

function App() {
  const termRef = useRef<TerminalHandle>(null);
  const ptyIdRef = useRef<number | null>(null);
  const initedRef = useRef(false);

  const handleData = useCallback((data: string) => {
    const id = ptyIdRef.current;
    if (id != null) {
      invoke("write_pty", { id, data });
    }
  }, []);

  const handleResize = useCallback((cols: number, rows: number) => {
    const id = ptyIdRef.current;
    if (id != null) {
      invoke("resize_pty", { id, cols, rows });
    }
  }, []);

  useEffect(() => {
    // Guard against StrictMode double-invoke
    if (initedRef.current) return;
    initedRef.current = true;

    let unlisten: (() => void) | null = null;

    async function init() {
      unlisten = await listen<PtyOutput>("pty-output", (event) => {
        const bytes = new Uint8Array(event.payload.data);
        const text = new TextDecoder().decode(bytes);
        termRef.current?.write(text);
      });

      const ptyId = await invoke<number>("create_pty", {});
      ptyIdRef.current = ptyId;
    }

    init();

    return () => {
      unlisten?.();
      const id = ptyIdRef.current;
      if (id != null) {
        invoke("close_pty", { id });
        ptyIdRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#1e1e2e" }}>
      <TerminalView ref={termRef} onData={handleData} onResize={handleResize} />
    </div>
  );
}

export default App;
