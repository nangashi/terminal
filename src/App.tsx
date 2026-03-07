import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TerminalView, TerminalHandle } from "./components/TerminalView";
import { TitleBar } from "./components/TitleBar";
import { Tab } from "./types";
import { PTY_OUTPUT_EVENT, PTY_EXIT_EVENT } from "./constants";
import "./App.css";

const DEBUG = import.meta.env.DEV;
function log(...args: unknown[]) {
  if (DEBUG) console.log("[App]", ...args);
}

interface PtyOutput {
  id: number;
  data: number[];
}

interface PtyExit {
  id: number;
}

interface TabState {
  tab: Tab;
  ptyId: number | null;
}

function createTabId(): string {
  return crypto.randomUUID();
}

function App() {
  const nextTabNum = useRef(1);

  const [tabStates, setTabStates] = useState<TabState[]>(() => {
    const id = createTabId();
    return [
      { tab: { id, title: `Terminal ${nextTabNum.current++}` }, ptyId: null },
    ];
  });
  const [activeTabId, setActiveTabId] = useState(() => tabStates[0].tab.id);

  const termRefs = useRef<Map<string, TerminalHandle>>(new Map());
  const ptyToTab = useRef<Map<number, string>>(new Map());
  const initedRef = useRef(false);
  const unlistenRefs = useRef<(() => void)[]>([]);
  const spawningTabs = useRef<Set<string>>(new Set());
  const tabStatesRef = useRef(tabStates);
  tabStatesRef.current = tabStates;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // Set up global PTY event listeners once
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;

    async function setupListeners() {
      const unlistenOutput = await listen<PtyOutput>(
        PTY_OUTPUT_EVENT,
        (event) => {
          const ptyId = event.payload.id;
          const tabId = ptyToTab.current.get(ptyId);
          if (!tabId) return;
          const bytes = new Uint8Array(event.payload.data);
          const text = new TextDecoder().decode(bytes);
          termRefs.current.get(tabId)?.write(text);
        },
      );

      const unlistenExit = await listen<PtyExit>(PTY_EXIT_EVENT, (event) => {
        const ptyId = event.payload.id;
        const tabId = ptyToTab.current.get(ptyId);
        if (!tabId) return;
        log("PTY exited:", ptyId, "tab:", tabId);
        ptyToTab.current.delete(ptyId);
        termRefs.current.delete(tabId);

        setTabStates((prev) => {
          const remaining = prev.filter((s) => s.tab.id !== tabId);
          if (remaining.length === 0) {
            import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
              getCurrentWindow().close(),
            );
            return prev;
          }
          return remaining;
        });

        // Switch active tab if the exited one was active
        if (activeTabIdRef.current === tabId) {
          setTabStates((prev) => {
            if (prev.length > 0) {
              setActiveTabId(prev[Math.max(0, prev.length - 1)].tab.id);
            }
            return prev;
          });
        }
      });

      unlistenRefs.current = [unlistenOutput, unlistenExit];
      log("PTY event listeners registered");
    }

    setupListeners();

    return () => {
      for (const unlisten of unlistenRefs.current) unlisten();
    };
  }, []);

  // Spawn PTY for tabs that don't have one
  useEffect(() => {
    for (const ts of tabStates) {
      if (ts.ptyId != null) continue;
      if (spawningTabs.current.has(ts.tab.id)) continue;

      spawningTabs.current.add(ts.tab.id);
      log("Spawning PTY for tab", ts.tab.id, ts.tab.title);

      const handle = termRefs.current.get(ts.tab.id);
      const cols = handle?.terminal?.cols;
      const rows = handle?.terminal?.rows;

      invoke<number>("create_pty", {
        ...(cols != null && rows != null ? { cols, rows } : {}),
      }).then((ptyId) => {
        log("PTY created:", ptyId, "for tab", ts.tab.id);
        spawningTabs.current.delete(ts.tab.id);
        ptyToTab.current.set(ptyId, ts.tab.id);
        setTabStates((prev) =>
          prev.map((s) => (s.tab.id === ts.tab.id ? { ...s, ptyId } : s)),
        );

        // Sync size in case the terminal was resized during async PTY creation
        const cur = termRefs.current.get(ts.tab.id);
        const curCols = cur?.terminal?.cols;
        const curRows = cur?.terminal?.rows;
        if (curCols != null && curRows != null) {
          if (curCols !== (cols ?? 80) || curRows !== (rows ?? 24)) {
            invoke("resize_pty", { id: ptyId, cols: curCols, rows: curRows });
          }
        }
      });
    }
  }, [tabStates]);

  const handleData = useCallback((tabId: string, data: string) => {
    const ts = tabStatesRef.current.find((s) => s.tab.id === tabId);
    log(
      "Input from tab",
      tabId,
      "ptyId:",
      ts?.ptyId,
      "data:",
      JSON.stringify(data),
    );
    if (ts?.ptyId != null) {
      invoke("write_pty", { id: ts.ptyId, data });
    }
  }, []);

  const handleResize = useCallback(
    (tabId: string, cols: number, rows: number) => {
      const ts = tabStatesRef.current.find((s) => s.tab.id === tabId);
      if (ts?.ptyId != null) {
        log("Resize tab", tabId, "ptyId:", ts.ptyId, cols, "x", rows);
        invoke("resize_pty", { id: ts.ptyId, cols, rows });
      }
    },
    [],
  );

  const handleNewTab = useCallback(() => {
    const id = createTabId();
    const tab: Tab = { id, title: `Terminal ${nextTabNum.current++}` };
    log("New tab:", id, tab.title);
    setTabStates((prev) => [...prev, { tab, ptyId: null }]);
    setActiveTabId(id);
  }, []);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const ts = tabStates.find((s) => s.tab.id === tabId);
      log("Close tab:", tabId, "ptyId:", ts?.ptyId);

      if (ts?.ptyId != null) {
        invoke("close_pty", { id: ts.ptyId });
        ptyToTab.current.delete(ts.ptyId);
      }
      termRefs.current.delete(tabId);

      const remaining = tabStates.filter((s) => s.tab.id !== tabId);

      if (remaining.length === 0) {
        import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
          getCurrentWindow().close(),
        );
        return;
      }

      if (activeTabId === tabId) {
        const closedIdx = tabStates.findIndex((s) => s.tab.id === tabId);
        const newIdx = Math.min(closedIdx, remaining.length - 1);
        setActiveTabId(remaining[newIdx].tab.id);
      }

      setTabStates(remaining);
    },
    [tabStates, activeTabId],
  );

  const handleReorderTabs = useCallback((reordered: Tab[]) => {
    setTabStates((prev) => {
      const byId = new Map(prev.map((s) => [s.tab.id, s]));
      return reordered.map((tab) => ({ ...byId.get(tab.id)!, tab }));
    });
  }, []);

  const setTermRef = useCallback(
    (tabId: string, handle: TerminalHandle | null) => {
      if (handle) {
        termRefs.current.set(tabId, handle);
      } else {
        termRefs.current.delete(tabId);
      }
    },
    [],
  );

  const tabs = tabStates.map((s) => s.tab);

  return (
    <div className="app-root">
      <TitleBar
        tabs={tabs}
        activeTabId={activeTabId}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
        onSelectTab={setActiveTabId}
        onReorderTabs={handleReorderTabs}
      />
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {tabStates.map((ts) => (
          <div
            key={ts.tab.id}
            style={{
              width: "100%",
              height: "100%",
              position: "absolute",
              top: 0,
              left: 0,
              visibility: ts.tab.id === activeTabId ? "visible" : "hidden",
            }}
          >
            <TerminalView
              ref={(handle) => setTermRef(ts.tab.id, handle)}
              onData={(data) => handleData(ts.tab.id, data)}
              onResize={(cols, rows) => handleResize(ts.tab.id, cols, rows)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
