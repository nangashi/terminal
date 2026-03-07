import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TerminalHandle } from "./components/TerminalView";
import { TitleBar } from "./components/TitleBar";
import { PaneContainer } from "./components/PaneContainer";
import { PrefixModeIndicator } from "./components/PrefixModeIndicator";
import { usePrefixKey, PrefixAction } from "./hooks/usePrefixKey";
import { Tab, PaneNode } from "./types";
import {
  createLeaf,
  splitPane,
  closePane,
  allLeaves,
  updateLeafPtyId,
  updateRatio,
  findAdjacentPane,
  findParentSplit,
} from "./lib/paneTree";
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
  paneTree: PaneNode;
  activePaneId: string;
}

function createTabId(): string {
  return crypto.randomUUID();
}

function createInitialTabState(title: string): TabState {
  const leaf = createLeaf();
  return {
    tab: { id: createTabId(), title },
    paneTree: leaf,
    activePaneId: leaf.id,
  };
}

function App() {
  const nextTabNum = useRef(1);

  const [tabStates, setTabStates] = useState<TabState[]>(() => {
    return [createInitialTabState(`Terminal ${nextTabNum.current++}`)];
  });
  const [activeTabId, setActiveTabId] = useState(() => tabStates[0].tab.id);

  // paneId -> TerminalHandle
  const termRefs = useRef<Map<string, TerminalHandle>>(new Map());
  // ptyId -> { tabId, paneId }
  const ptyToPane = useRef<Map<number, { tabId: string; paneId: string }>>(
    new Map(),
  );
  const initedRef = useRef(false);
  const unlistenRefs = useRef<(() => void)[]>([]);
  const spawningPanes = useRef<Set<string>>(new Set());
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
          const mapping = ptyToPane.current.get(ptyId);
          if (!mapping) return;
          const bytes = new Uint8Array(event.payload.data);
          const text = new TextDecoder().decode(bytes);
          termRefs.current.get(mapping.paneId)?.write(text);
        },
      );

      const unlistenExit = await listen<PtyExit>(PTY_EXIT_EVENT, (event) => {
        const ptyId = event.payload.id;
        const mapping = ptyToPane.current.get(ptyId);
        if (!mapping) return;
        log("PTY exited:", ptyId, "pane:", mapping.paneId);
        ptyToPane.current.delete(ptyId);
        termRefs.current.delete(mapping.paneId);

        setTabStates((prev) => {
          const tabState = prev.find((s) => s.tab.id === mapping.tabId);
          if (!tabState) return prev;

          const newTree = closePane(tabState.paneTree, mapping.paneId);

          if (newTree === null) {
            // Last pane in tab - remove tab
            const remaining = prev.filter((s) => s.tab.id !== mapping.tabId);
            if (remaining.length === 0) {
              import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
                getCurrentWindow().close(),
              );
              return prev;
            }

            // Switch active tab if needed
            if (activeTabIdRef.current === mapping.tabId) {
              const newActiveIdx = Math.max(0, remaining.length - 1);
              setActiveTabId(remaining[newActiveIdx].tab.id);
            }
            return remaining;
          }

          // Pane removed but tab survives
          const leaves = allLeaves(newTree);
          const newActivePaneId = leaves.some(
            (l) => l.id === tabState.activePaneId,
          )
            ? tabState.activePaneId
            : leaves[0].id;

          return prev.map((s) =>
            s.tab.id === mapping.tabId
              ? { ...s, paneTree: newTree, activePaneId: newActivePaneId }
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
  }, []);

  // Spawn PTY for panes that don't have one
  useEffect(() => {
    for (const ts of tabStates) {
      for (const leaf of allLeaves(ts.paneTree)) {
        if (leaf.ptyId != null) continue;
        if (spawningPanes.current.has(leaf.id)) continue;

        spawningPanes.current.add(leaf.id);
        const paneId = leaf.id;
        const tabId = ts.tab.id;
        log("Spawning PTY for pane", paneId, "in tab", tabId);

        const handle = termRefs.current.get(paneId);
        const cols = handle?.terminal?.cols;
        const rows = handle?.terminal?.rows;

        invoke<number>("create_pty", {
          ...(cols != null && rows != null ? { cols, rows } : {}),
        }).then((ptyId) => {
          log("PTY created:", ptyId, "for pane", paneId);
          spawningPanes.current.delete(paneId);
          ptyToPane.current.set(ptyId, { tabId, paneId });
          setTabStates((prev) =>
            prev.map((s) =>
              s.tab.id === tabId
                ? { ...s, paneTree: updateLeafPtyId(s.paneTree, paneId, ptyId) }
                : s,
            ),
          );

          const cur = termRefs.current.get(paneId);
          const curCols = cur?.terminal?.cols;
          const curRows = cur?.terminal?.rows;
          if (curCols != null && curRows != null) {
            if (curCols !== (cols ?? 80) || curRows !== (rows ?? 24)) {
              invoke("resize_pty", { id: ptyId, cols: curCols, rows: curRows });
            }
          }
        });
      }
    }
  }, [tabStates]);

  const handlePaneData = useCallback((paneId: string, data: string) => {
    for (const [ptyId, mapping] of ptyToPane.current) {
      if (mapping.paneId === paneId) {
        log("Input from pane", paneId, "ptyId:", ptyId);
        invoke("write_pty", { id: ptyId, data });
        return;
      }
    }
  }, []);

  const handlePaneResize = useCallback(
    (paneId: string, cols: number, rows: number) => {
      for (const [ptyId, mapping] of ptyToPane.current) {
        if (mapping.paneId === paneId) {
          log("Resize pane", paneId, "ptyId:", ptyId, cols, "x", rows);
          invoke("resize_pty", { id: ptyId, cols, rows });
          return;
        }
      }
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
      prev.map((s) =>
        s.tab.id === activeTabIdRef.current
          ? { ...s, activePaneId: paneId }
          : s,
      ),
    );
  }, []);

  const handleDividerDrag = useCallback(
    (splitNodeId: string, delta: number) => {
      setTabStates((prev) =>
        prev.map((s) => {
          if (s.tab.id !== activeTabIdRef.current) return s;
          if (s.paneTree.type !== "split") return s;
          // Find the split and update ratio
          const currentTree = s.paneTree;
          const findSplit = (
            node: PaneNode,
          ): Extract<PaneNode, { type: "split" }> | null => {
            if (node.type === "leaf") return null;
            if (node.id === splitNodeId) return node;
            return findSplit(node.first) ?? findSplit(node.second);
          };
          const split = findSplit(currentTree);
          if (!split) return s;
          const newRatio = split.ratio + delta;
          return {
            ...s,
            paneTree: updateRatio(s.paneTree, splitNodeId, newRatio),
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

    switch (action) {
      case "split-horizontal":
      case "split-vertical": {
        const direction =
          action === "split-horizontal" ? "horizontal" : "vertical";
        const result = splitPane(
          currentTab.paneTree,
          currentTab.activePaneId,
          direction,
        );
        if (result) {
          setTabStates((prev) =>
            prev.map((s) =>
              s.tab.id === currentTabId
                ? {
                    ...s,
                    paneTree: result.tree,
                    activePaneId: result.newPaneId,
                  }
                : s,
            ),
          );
        }
        break;
      }
      case "navigate-left":
      case "navigate-right":
      case "navigate-up":
      case "navigate-down": {
        const dir = action.replace("navigate-", "") as
          | "left"
          | "right"
          | "up"
          | "down";
        const target = findAdjacentPane(
          currentTab.paneTree,
          currentTab.activePaneId,
          dir,
        );
        if (target) {
          setTabStates((prev) =>
            prev.map((s) =>
              s.tab.id === currentTabId ? { ...s, activePaneId: target } : s,
            ),
          );
        }
        break;
      }
      case "resize-left":
      case "resize-right":
      case "resize-up":
      case "resize-down": {
        const dir = action.replace("resize-", "") as
          | "left"
          | "right"
          | "up"
          | "down";
        const info = findParentSplit(
          currentTab.paneTree,
          currentTab.activePaneId,
          dir,
        );
        if (info) {
          setTabStates((prev) =>
            prev.map((s) => {
              if (s.tab.id !== currentTabId) return s;
              const findSplit = (
                node: PaneNode,
              ): Extract<PaneNode, { type: "split" }> | null => {
                if (node.type === "leaf") return null;
                if (node.id === info.splitId) return node;
                return findSplit(node.first) ?? findSplit(node.second);
              };
              const split = findSplit(s.paneTree);
              if (!split) return s;
              return {
                ...s,
                paneTree: updateRatio(
                  s.paneTree,
                  info.splitId,
                  split.ratio + info.delta,
                ),
              };
            }),
          );
        }
        break;
      }
      case "close-pane": {
        const leaves = allLeaves(currentTab.paneTree);
        const activePaneId = currentTab.activePaneId;
        const activeLeaf = leaves.find((l) => l.id === activePaneId);

        // Close the PTY for this pane
        if (activeLeaf?.ptyId != null) {
          invoke("close_pty", { id: activeLeaf.ptyId });
          ptyToPane.current.delete(activeLeaf.ptyId);
        }
        termRefs.current.delete(activePaneId);

        const newTree = closePane(currentTab.paneTree, activePaneId);
        if (newTree === null) {
          // Last pane - close the tab
          const remaining = tabStatesRef.current.filter(
            (s) => s.tab.id !== currentTabId,
          );
          if (remaining.length === 0) {
            import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
              getCurrentWindow().close(),
            );
            return;
          }
          setTabStates(remaining);
          if (activeTabIdRef.current === currentTabId) {
            setActiveTabId(remaining[Math.max(0, remaining.length - 1)].tab.id);
          }
        } else {
          const newLeaves = allLeaves(newTree);
          const newActivePaneId = newLeaves[0].id;
          setTabStates((prev) =>
            prev.map((s) =>
              s.tab.id === currentTabId
                ? { ...s, paneTree: newTree, activePaneId: newActivePaneId }
                : s,
            ),
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

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const ts = tabStates.find((s) => s.tab.id === tabId);
      if (!ts) return;
      log("Close tab:", tabId);

      // Close all PTYs in this tab
      for (const leaf of allLeaves(ts.paneTree)) {
        if (leaf.ptyId != null) {
          invoke("close_pty", { id: leaf.ptyId });
          ptyToPane.current.delete(leaf.ptyId);
        }
        termRefs.current.delete(leaf.id);
      }

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
            <PaneContainer
              node={ts.paneTree}
              activePaneId={ts.tab.id === activeTabId ? ts.activePaneId : ""}
              onData={handlePaneData}
              onResize={handlePaneResize}
              onPaneRef={handlePaneRef}
              onPaneFocus={handlePaneFocus}
              onDividerDrag={handleDividerDrag}
            />
          </div>
        ))}
      </div>
      <PrefixModeIndicator visible={isPrefixMode} />
    </div>
  );
}

export default App;
