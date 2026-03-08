import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TerminalHandle } from "./components/TerminalView";
import { TitleBar } from "./components/TitleBar";
import { PaneContainer } from "./components/PaneContainer";
import { PrefixModeIndicator } from "./components/PrefixModeIndicator";
import { Sidebar, PaneInfo } from "./components/Sidebar";
import { usePrefixKey, PrefixAction } from "./hooks/usePrefixKey";
import { usePaneMetadata } from "./hooks/usePaneMetadata";
import { useClaudeStatus } from "./hooks/useClaudeStatus";
import { Tab } from "./types";
import {
  splitPane,
  closePane,
  allLeaves,
  updateLeafPtyId,
  updateRatio,
  findSplitNode,
  findAdjacentPane,
  findParentSplit,
} from "./lib/paneTree";
import {
  createWindowState,
  allLeavesInTab,
  findWindowContainingPane,
  WindowState,
} from "./lib/windowHelpers";
import { PTY_OUTPUT_EVENT, PTY_EXIT_EVENT } from "./constants";
import "./App.css";

const textDecoder = new TextDecoder();

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
  windows: WindowState[];
  activeWindowId: string;
  nextWindowNum: number;
}

function closeAppWindow() {
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
    getCurrentWindow().close(),
  );
}

function createTabId(): string {
  return crypto.randomUUID();
}

function createInitialTabState(title: string): TabState {
  const ws = createWindowState("Window 1");
  return {
    tab: { id: createTabId(), title },
    windows: [ws],
    activeWindowId: ws.window.id,
    nextWindowNum: 2,
  };
}

function getActiveWindow(tabState: TabState): WindowState | undefined {
  return tabState.windows.find(
    (ws) => ws.window.id === tabState.activeWindowId,
  );
}

function updateWindow(
  tabState: TabState,
  windowId: string,
  updater: (ws: WindowState) => WindowState,
): TabState {
  return {
    ...tabState,
    windows: tabState.windows.map((ws) =>
      ws.window.id === windowId ? updater(ws) : ws,
    ),
  };
}

function App() {
  const nextTabNum = useRef(2);

  const [tabStates, setTabStates] = useState<TabState[]>(() => {
    return [createInitialTabState("Terminal 1")];
  });
  const [activeTabId, setActiveTabId] = useState(() => tabStates[0].tab.id);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const { claudeStatus, handleTitleChange } = useClaudeStatus();

  // paneId -> TerminalHandle
  const termRefs = useRef<Map<string, TerminalHandle>>(new Map());
  // ptyId -> { tabId, windowId, paneId }
  const ptyToPane = useRef<
    Map<number, { tabId: string; windowId: string; paneId: string }>
  >(new Map());
  // paneId -> ptyId (reverse index for O(1) lookup)
  const paneToPty = useRef<Map<string, number>>(new Map());
  const initedRef = useRef(false);
  const unlistenRefs = useRef<(() => void)[]>([]);
  const spawningPanes = useRef<Set<string>>(new Set());
  const tabStatesRef = useRef(tabStates);
  const activeTabIdRef = useRef(activeTabId);

  useEffect(() => {
    tabStatesRef.current = tabStates;
  }, [tabStates]);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  // Set up global PTY event listeners once
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;

    async function setupListeners() {
      const unlistenOutput = await listen<PtyOutput>(
        PTY_OUTPUT_EVENT,
        (event) => {
          const ptyId = event.payload.id;
          const mapping = ptyToPane.current.get(ptyId);
          if (!mapping) return;
          const bytes = new Uint8Array(event.payload.data);
          const text = textDecoder.decode(bytes);
          termRefs.current.get(mapping.paneId)?.write(text);
        },
      );

      const unlistenExit = await listen<PtyExit>(PTY_EXIT_EVENT, (event) => {
        const ptyId = event.payload.id;
        const mapping = ptyToPane.current.get(ptyId);
        if (!mapping) return;
        log("PTY exited:", ptyId, "pane:", mapping.paneId);
        ptyToPane.current.delete(ptyId);
        paneToPty.current.delete(mapping.paneId);
        termRefs.current.delete(mapping.paneId);
        handleTitleChange(mapping.paneId, "");

        setTabStates((prev) => {
          const tabState = prev.find((s) => s.tab.id === mapping.tabId);
          if (!tabState) return prev;

          const win = tabState.windows.find(
            (ws) => ws.window.id === mapping.windowId,
          );
          if (!win) return prev;

          const newTree = closePane(win.paneTree, mapping.paneId);

          if (newTree === null) {
            // Last pane in window - remove window
            const remainingWindows = tabState.windows.filter(
              (ws) => ws.window.id !== mapping.windowId,
            );

            if (remainingWindows.length === 0) {
              // Last window in tab - remove tab
              const remaining = prev.filter((s) => s.tab.id !== mapping.tabId);
              if (remaining.length === 0) {
                closeAppWindow();
                return prev;
              }

              if (activeTabIdRef.current === mapping.tabId) {
                const newActiveIdx = Math.max(0, remaining.length - 1);
                setActiveTabId(remaining[newActiveIdx].tab.id);
              }
              return remaining;
            }

            // Window removed but tab survives
            const newActiveWindowId =
              tabState.activeWindowId === mapping.windowId
                ? remainingWindows[Math.max(0, remainingWindows.length - 1)]
                    .window.id
                : tabState.activeWindowId;

            return prev.map((s) =>
              s.tab.id === mapping.tabId
                ? {
                    ...s,
                    windows: remainingWindows,
                    activeWindowId: newActiveWindowId,
                  }
                : s,
            );
          }

          // Pane removed but window survives
          const leaves = allLeaves(newTree);
          const newActivePaneId = leaves.some((l) => l.id === win.activePaneId)
            ? win.activePaneId
            : leaves[0].id;

          return prev.map((s) =>
            s.tab.id === mapping.tabId
              ? updateWindow(s, mapping.windowId, (ws) => ({
                  ...ws,
                  paneTree: newTree,
                  activePaneId: newActivePaneId,
                }))
              : s,
          );
        });
      });

      unlistenRefs.current = [unlistenOutput, unlistenExit];
      log("PTY event listeners registered");
    }

    setupListeners();

    return () => {
      for (const unlisten of unlistenRefs.current) unlisten();
    };
  }, [handleTitleChange]);

  // Spawn PTY for panes that don't have one
  useEffect(() => {
    for (const ts of tabStates) {
      for (const ws of ts.windows) {
        for (const leaf of allLeaves(ws.paneTree)) {
          if (leaf.ptyId != null) continue;
          if (spawningPanes.current.has(leaf.id)) continue;

          spawningPanes.current.add(leaf.id);
          const paneId = leaf.id;
          const tabId = ts.tab.id;
          const windowId = ws.window.id;
          log("Spawning PTY for pane", paneId, "in tab", tabId);

          const handle = termRefs.current.get(paneId);
          const cols = handle?.terminal?.cols;
          const rows = handle?.terminal?.rows;

          invoke<number>("create_pty", {
            ...(cols != null && rows != null ? { cols, rows } : {}),
            ...(leaf.initialCwd ? { cwd: leaf.initialCwd } : {}),
          }).then((ptyId) => {
            log("PTY created:", ptyId, "for pane", paneId);
            spawningPanes.current.delete(paneId);
            ptyToPane.current.set(ptyId, { tabId, windowId, paneId });
            paneToPty.current.set(paneId, ptyId);
            setTabStates((prev) =>
              prev.map((s) =>
                s.tab.id === tabId
                  ? updateWindow(s, windowId, (w) => ({
                      ...w,
                      paneTree: updateLeafPtyId(w.paneTree, paneId, ptyId),
                    }))
                  : s,
              ),
            );

            const cur = termRefs.current.get(paneId);
            const curCols = cur?.terminal?.cols;
            const curRows = cur?.terminal?.rows;
            if (curCols != null && curRows != null) {
              if (curCols !== (cols ?? 80) || curRows !== (rows ?? 24)) {
                invoke("resize_pty", {
                  id: ptyId,
                  cols: curCols,
                  rows: curRows,
                });
              }
            }
          });
        }
      }
    }
  }, [tabStates]);

  const handlePaneData = useCallback((paneId: string, data: string) => {
    const ptyId = paneToPty.current.get(paneId);
    if (ptyId == null) return;
    log("Input from pane", paneId, "ptyId:", ptyId);
    invoke("write_pty", { id: ptyId, data });
  }, []);

  const handlePaneResize = useCallback(
    (paneId: string, cols: number, rows: number) => {
      const ptyId = paneToPty.current.get(paneId);
      if (ptyId == null) return;
      log("Resize pane", paneId, "ptyId:", ptyId, cols, "x", rows);
      invoke("resize_pty", { id: ptyId, cols, rows });
    },
    [],
  );

  const handlePaneRef = useCallback(
    (paneId: string, handle: TerminalHandle | null) => {
      if (handle) {
        termRefs.current.set(paneId, handle);
      } else {
        termRefs.current.delete(paneId);
      }
    },
    [],
  );

  const handlePaneFocus = useCallback((paneId: string) => {
    setTabStates((prev) =>
      prev.map((s) => {
        if (s.tab.id !== activeTabIdRef.current) return s;
        const win = findWindowContainingPane(s.windows, paneId);
        if (!win) return s;
        return {
          ...s,
          activeWindowId: win.window.id,
          windows: s.windows.map((ws) =>
            ws.window.id === win.window.id
              ? { ...ws, activePaneId: paneId }
              : ws,
          ),
        };
      }),
    );
  }, []);

  const handleDividerDrag = useCallback(
    (splitNodeId: string, delta: number) => {
      setTabStates((prev) =>
        prev.map((s) => {
          if (s.tab.id !== activeTabIdRef.current) return s;
          return {
            ...s,
            windows: s.windows.map((ws) => {
              const split = findSplitNode(ws.paneTree, splitNodeId);
              if (!split) return ws;
              return {
                ...ws,
                paneTree: updateRatio(
                  ws.paneTree,
                  splitNodeId,
                  split.ratio + delta,
                ),
              };
            }),
          };
        }),
      );
    },
    [],
  );

  const handlePrefixAction = useCallback((action: PrefixAction) => {
    const currentTabId = activeTabIdRef.current;
    const currentTab = tabStatesRef.current.find(
      (s) => s.tab.id === currentTabId,
    );
    if (!currentTab) return;

    const activeWin = getActiveWindow(currentTab);
    if (!activeWin && action !== "cancel" && action !== "toggle-sidebar")
      return;

    switch (action) {
      case "split-horizontal":
      case "split-vertical": {
        const direction =
          action === "split-horizontal" ? "horizontal" : "vertical";
        const activePtyId = paneToPty.current.get(activeWin!.activePaneId);
        const cwdPromise =
          activePtyId != null
            ? invoke<string>("get_pty_cwd", { id: activePtyId }).catch(
                () => undefined,
              )
            : Promise.resolve(undefined);
        cwdPromise.then((cwd) => {
          const tab = tabStatesRef.current.find(
            (s) => s.tab.id === currentTabId,
          );
          if (!tab) return;
          const win = getActiveWindow(tab);
          if (!win) return;
          const result = splitPane(
            win.paneTree,
            win.activePaneId,
            direction,
            cwd,
          );
          if (result) {
            setTabStates((prev) =>
              prev.map((s) =>
                s.tab.id === currentTabId
                  ? updateWindow(s, win.window.id, (ws) => ({
                      ...ws,
                      paneTree: result.tree,
                      activePaneId: result.newPaneId,
                    }))
                  : s,
              ),
            );
          }
        });
        break;
      }
      case "navigate-left":
      case "navigate-right":
      case "navigate-up":
      case "navigate-down": {
        const dirMap = {
          "navigate-left": "left",
          "navigate-right": "right",
          "navigate-up": "up",
          "navigate-down": "down",
        } as const;
        const dir = dirMap[action];
        const target = findAdjacentPane(
          activeWin!.paneTree,
          activeWin!.activePaneId,
          dir,
        );
        if (target) {
          setTabStates((prev) =>
            prev.map((s) =>
              s.tab.id === currentTabId
                ? updateWindow(s, activeWin!.window.id, (ws) => ({
                    ...ws,
                    activePaneId: target,
                  }))
                : s,
            ),
          );
        }
        break;
      }
      case "resize-left":
      case "resize-right":
      case "resize-up":
      case "resize-down": {
        const resizeDirMap = {
          "resize-left": "left",
          "resize-right": "right",
          "resize-up": "up",
          "resize-down": "down",
        } as const;
        const dir = resizeDirMap[action];
        const info = findParentSplit(
          activeWin!.paneTree,
          activeWin!.activePaneId,
          dir,
        );
        if (info) {
          setTabStates((prev) =>
            prev.map((s) => {
              if (s.tab.id !== currentTabId) return s;
              return updateWindow(s, activeWin!.window.id, (ws) => {
                const split = findSplitNode(ws.paneTree, info.splitId);
                if (!split) return ws;
                return {
                  ...ws,
                  paneTree: updateRatio(
                    ws.paneTree,
                    info.splitId,
                    split.ratio + info.delta,
                  ),
                };
              });
            }),
          );
        }
        break;
      }
      case "close-pane": {
        const leaves = allLeaves(activeWin!.paneTree);
        const activePaneId = activeWin!.activePaneId;
        const activeLeaf = leaves.find((l) => l.id === activePaneId);

        // Close the PTY for this pane
        if (activeLeaf?.ptyId != null) {
          invoke("close_pty", { id: activeLeaf.ptyId });
          ptyToPane.current.delete(activeLeaf.ptyId);
          paneToPty.current.delete(activePaneId);
        }
        termRefs.current.delete(activePaneId);

        const newTree = closePane(activeWin!.paneTree, activePaneId);
        if (newTree === null) {
          // Last pane in window - remove window
          const remainingWindows = currentTab.windows.filter(
            (ws) => ws.window.id !== activeWin!.window.id,
          );

          if (remainingWindows.length === 0) {
            // Last window in tab - close the tab
            const remaining = tabStatesRef.current.filter(
              (s) => s.tab.id !== currentTabId,
            );
            if (remaining.length === 0) {
              closeAppWindow();
              return;
            }
            setTabStates(remaining);
            if (activeTabIdRef.current === currentTabId) {
              setActiveTabId(
                remaining[Math.max(0, remaining.length - 1)].tab.id,
              );
            }
          } else {
            const newActiveWindowId =
              remainingWindows[Math.max(0, remainingWindows.length - 1)].window
                .id;
            setTabStates((prev) =>
              prev.map((s) =>
                s.tab.id === currentTabId
                  ? {
                      ...s,
                      windows: remainingWindows,
                      activeWindowId: newActiveWindowId,
                    }
                  : s,
              ),
            );
          }
        } else {
          const newLeaves = allLeaves(newTree);
          const newActivePaneId = newLeaves[0].id;
          setTabStates((prev) =>
            prev.map((s) =>
              s.tab.id === currentTabId
                ? updateWindow(s, activeWin!.window.id, (ws) => ({
                    ...ws,
                    paneTree: newTree,
                    activePaneId: newActivePaneId,
                  }))
                : s,
            ),
          );
        }
        break;
      }
      case "toggle-sidebar":
        setSidebarVisible((v) => !v);
        break;
      case "create-window": {
        const activePtyId = paneToPty.current.get(activeWin!.activePaneId);
        const cwdPromise =
          activePtyId != null
            ? invoke<string>("get_pty_cwd", { id: activePtyId }).catch(
                () => undefined,
              )
            : Promise.resolve(undefined);
        cwdPromise.then((cwd) => {
          const tab = tabStatesRef.current.find(
            (s) => s.tab.id === currentTabId,
          );
          if (!tab) return;
          const newWin = createWindowState(`Window ${tab.nextWindowNum}`, cwd);
          setTabStates((prev) =>
            prev.map((s) =>
              s.tab.id === currentTabId
                ? {
                    ...s,
                    windows: [...s.windows, newWin],
                    activeWindowId: newWin.window.id,
                    nextWindowNum: s.nextWindowNum + 1,
                  }
                : s,
            ),
          );
        });
        break;
      }
      case "next-window": {
        const windows = currentTab.windows;
        if (windows.length <= 1) break;
        const currentIdx = windows.findIndex(
          (ws) => ws.window.id === currentTab.activeWindowId,
        );
        const nextIdx = (currentIdx + 1) % windows.length;
        setTabStates((prev) =>
          prev.map((s) =>
            s.tab.id === currentTabId
              ? { ...s, activeWindowId: windows[nextIdx].window.id }
              : s,
          ),
        );
        break;
      }
      case "prev-window": {
        const windows = currentTab.windows;
        if (windows.length <= 1) break;
        const currentIdx = windows.findIndex(
          (ws) => ws.window.id === currentTab.activeWindowId,
        );
        const prevIdx = (currentIdx - 1 + windows.length) % windows.length;
        setTabStates((prev) =>
          prev.map((s) =>
            s.tab.id === currentTabId
              ? { ...s, activeWindowId: windows[prevIdx].window.id }
              : s,
          ),
        );
        break;
      }
      case "select-pane-1":
      case "select-pane-2":
      case "select-pane-3":
      case "select-pane-4":
      case "select-pane-5":
      case "select-pane-6":
      case "select-pane-7":
      case "select-pane-8":
      case "select-pane-9": {
        const idx = parseInt(action.slice(-1)) - 1;
        // Collect all leaves across all windows with their window reference
        const allPanes: { paneId: string; windowId: string }[] = [];
        for (const ws of currentTab.windows) {
          for (const leaf of allLeaves(ws.paneTree)) {
            allPanes.push({ paneId: leaf.id, windowId: ws.window.id });
          }
        }
        if (idx < allPanes.length) {
          const target = allPanes[idx];
          setTabStates((prev) =>
            prev.map((s) => {
              if (s.tab.id !== currentTabId) return s;
              return {
                ...s,
                activeWindowId: target.windowId,
                windows: s.windows.map((ws) =>
                  ws.window.id === target.windowId
                    ? { ...ws, activePaneId: target.paneId }
                    : ws,
                ),
              };
            }),
          );
        }
        break;
      }
      case "cancel":
        break;
    }
  }, []);

  const { isPrefixMode } = usePrefixKey(handlePrefixAction);

  const handleNewTab = useCallback(() => {
    const ts = createInitialTabState(`Terminal ${nextTabNum.current++}`);
    log("New tab:", ts.tab.id, ts.tab.title);
    setTabStates((prev) => [...prev, ts]);
    setActiveTabId(ts.tab.id);
  }, []);

  const handleCloseTab = useCallback((tabId: string) => {
    const ts = tabStatesRef.current.find((s) => s.tab.id === tabId);
    if (!ts) return;
    log("Close tab:", tabId);

    // Close all PTYs in all windows of this tab
    for (const ws of ts.windows) {
      for (const leaf of allLeaves(ws.paneTree)) {
        if (leaf.ptyId != null) {
          invoke("close_pty", { id: leaf.ptyId });
          ptyToPane.current.delete(leaf.ptyId);
          paneToPty.current.delete(leaf.id);
        }
        termRefs.current.delete(leaf.id);
      }
    }

    const remaining = tabStatesRef.current.filter((s) => s.tab.id !== tabId);

    if (remaining.length === 0) {
      closeAppWindow();
      return;
    }

    if (activeTabIdRef.current === tabId) {
      const closedIdx = tabStatesRef.current.findIndex(
        (s) => s.tab.id === tabId,
      );
      const newIdx = Math.min(closedIdx, remaining.length - 1);
      setActiveTabId(remaining[newIdx].tab.id);
    }

    setTabStates(remaining);
  }, []);

  const handleRenameTab = useCallback((tabId: string, title: string) => {
    setTabStates((prev) =>
      prev.map((s) =>
        s.tab.id === tabId ? { ...s, tab: { ...s.tab, title } } : s,
      ),
    );
  }, []);

  const handleReorderTabs = useCallback((reordered: Tab[]) => {
    setTabStates((prev) => {
      const byId = new Map(prev.map((s) => [s.tab.id, s]));
      return reordered.map((tab) => ({ ...byId.get(tab.id)!, tab }));
    });
  }, []);

  const tabs = tabStates.map((s) => s.tab);

  const activeTabState = tabStates.find((s) => s.tab.id === activeTabId);
  const activeLeaves = useMemo(
    () => (activeTabState ? allLeavesInTab(activeTabState.windows) : []),
    [activeTabState],
  );
  const sidebarPanes: PaneInfo[] = activeTabState
    ? activeTabState.windows
        .flatMap((ws) =>
          allLeaves(ws.paneTree).map((leaf) => ({
            id: leaf.id,
            isActive:
              ws.window.id === activeTabState.activeWindowId &&
              leaf.id === ws.activePaneId,
            windowId: ws.window.id,
          })),
        )
        .map((p, i) => ({ ...p, index: i + 1 }))
    : [];

  const sidebarWindows = useMemo(
    () =>
      activeTabState
        ? activeTabState.windows.map((ws) => ({
            id: ws.window.id,
            title: ws.window.title,
            isActive: ws.window.id === activeTabState.activeWindowId,
          }))
        : [],
    [activeTabState],
  );

  const paneToPtyEntries: [string, number][] = useMemo(
    () =>
      activeLeaves
        .filter((leaf) => leaf.ptyId != null)
        .map((leaf) => [leaf.id, leaf.ptyId!]),
    [activeLeaves],
  );
  const paneMetadata = usePaneMetadata(paneToPtyEntries);

  const windowIndicators = useMemo(() => {
    const map = new Map<string, string>();
    for (const ts of tabStates) {
      if (ts.windows.length >= 2) {
        const activeIdx =
          ts.windows.findIndex((ws) => ws.window.id === ts.activeWindowId) + 1;
        map.set(ts.tab.id, `[${activeIdx}/${ts.windows.length}]`);
      }
    }
    return map;
  }, [tabStates]);

  // Window switch: fit and focus terminals
  const prevActiveWindowIdRef = useRef<string | null>(null);
  useEffect(() => {
    const activeTab = tabStates.find((ts) => ts.tab.id === activeTabId);
    if (!activeTab) return;
    const currentWindowId = activeTab.activeWindowId;
    if (prevActiveWindowIdRef.current === currentWindowId) return;
    prevActiveWindowIdRef.current = currentWindowId;

    const activeWin = activeTab.windows.find(
      (ws) => ws.window.id === currentWindowId,
    );
    if (!activeWin) return;
    requestAnimationFrame(() => {
      for (const leaf of allLeaves(activeWin.paneTree)) {
        termRefs.current.get(leaf.id)?.fit();
      }
      termRefs.current.get(activeWin.activePaneId)?.terminal?.focus();
    });
  }, [tabStates, activeTabId]);

  return (
    <div className="app-root">
      <TitleBar
        tabs={tabs}
        activeTabId={activeTabId}
        windowIndicators={windowIndicators}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
        onSelectTab={setActiveTabId}
        onRenameTab={handleRenameTab}
        onReorderTabs={handleReorderTabs}
      />
      <div className="app-main">
        {sidebarVisible && (
          <Sidebar
            panes={sidebarPanes}
            windows={sidebarWindows}
            metadata={paneMetadata}
            claudeStatus={claudeStatus}
            onSelectPane={handlePaneFocus}
          />
        )}
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
              {ts.windows.map((ws) => (
                <div
                  key={ws.window.id}
                  style={{
                    width: "100%",
                    height: "100%",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    visibility:
                      ts.tab.id === activeTabId &&
                      ws.window.id === ts.activeWindowId
                        ? "visible"
                        : "hidden",
                  }}
                >
                  <PaneContainer
                    node={ws.paneTree}
                    activePaneId={
                      ts.tab.id === activeTabId &&
                      ws.window.id === ts.activeWindowId
                        ? ws.activePaneId
                        : ""
                    }
                    onData={handlePaneData}
                    onResize={handlePaneResize}
                    onPaneRef={handlePaneRef}
                    onPaneFocus={handlePaneFocus}
                    onDividerDrag={handleDividerDrag}
                    onTitleChange={handleTitleChange}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <PrefixModeIndicator visible={isPrefixMode} />
    </div>
  );
}

export default App;
