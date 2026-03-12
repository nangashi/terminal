import { SplitDirection, NavigationDirection, TabState } from "../types";
import {
  splitPane,
  findAdjacentPane,
  findParentSplit,
  findSplitNode,
  updateRatio,
  allLeaves,
} from "./paneTree";
import { createWindowState, updateWindow } from "./windowHelpers";

export function applySplit(
  tabState: TabState,
  windowId: string,
  direction: SplitDirection,
  cwd?: string,
): TabState {
  const win = tabState.windows.find((ws) => ws.window.id === windowId);
  if (!win) return tabState;
  const result = splitPane(win.paneTree, win.activePaneId, direction, cwd);
  if (!result) return tabState;
  return updateWindow(tabState, windowId, (ws) => ({
    ...ws,
    paneTree: result.tree,
    activePaneId: result.newPaneId,
  }));
}

export function applyNavigate(
  tabState: TabState,
  windowId: string,
  activePaneId: string,
  direction: NavigationDirection,
): TabState {
  const win = tabState.windows.find((ws) => ws.window.id === windowId);
  if (!win) return tabState;
  const target = findAdjacentPane(win.paneTree, activePaneId, direction);
  if (!target) return tabState;
  return updateWindow(tabState, windowId, (ws) => ({
    ...ws,
    activePaneId: target,
  }));
}

export function applyResize(
  tabState: TabState,
  windowId: string,
  activePaneId: string,
  direction: NavigationDirection,
): TabState {
  const win = tabState.windows.find((ws) => ws.window.id === windowId);
  if (!win) return tabState;
  const info = findParentSplit(win.paneTree, activePaneId, direction);
  if (!info) return tabState;
  const split = findSplitNode(win.paneTree, info.splitId);
  if (!split) return tabState;
  return updateWindow(tabState, windowId, (ws) => ({
    ...ws,
    paneTree: updateRatio(ws.paneTree, info.splitId, split.ratio + info.delta),
  }));
}

export function applyCreateWindow(tabState: TabState, cwd?: string): TabState {
  const newWin = createWindowState(`Window ${tabState.nextWindowNum}`, cwd);
  return {
    ...tabState,
    windows: [...tabState.windows, newWin],
    activeWindowId: newWin.window.id,
    nextWindowNum: tabState.nextWindowNum + 1,
  };
}

export function applySwitchWindow(tabState: TabState, step: 1 | -1): TabState {
  const { windows } = tabState;
  if (windows.length <= 1) return tabState;
  const currentIdx = windows.findIndex(
    (ws) => ws.window.id === tabState.activeWindowId,
  );
  const nextIdx = (currentIdx + step + windows.length) % windows.length;
  return {
    ...tabState,
    activeWindowId: windows[nextIdx].window.id,
  };
}

export function applySelectPane(tabState: TabState, index: number): TabState {
  const allPanes: { paneId: string; windowId: string }[] = [];
  for (const ws of tabState.windows) {
    for (const leaf of allLeaves(ws.paneTree)) {
      allPanes.push({ paneId: leaf.id, windowId: ws.window.id });
    }
  }
  if (index < 0 || index >= allPanes.length) return tabState;
  const target = allPanes[index];
  return {
    ...tabState,
    activeWindowId: target.windowId,
    windows: tabState.windows.map((ws) =>
      ws.window.id === target.windowId
        ? { ...ws, activePaneId: target.paneId }
        : ws,
    ),
  };
}
