import { WindowState, TabState } from "../types";
import { createLeaf, allLeaves } from "./paneTree";

export type { WindowState } from "../types";

export function getActiveWindow(tabState: TabState): WindowState | undefined {
  return tabState.windows.find(
    (ws) => ws.window.id === tabState.activeWindowId,
  );
}

export function updateWindow(
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

export function createWindowId(): string {
  return crypto.randomUUID();
}

export function createWindowState(
  title: string,
  initialCwd?: string,
): WindowState {
  const leaf = createLeaf(initialCwd);
  return {
    window: { id: createWindowId(), title },
    paneTree: leaf,
    activePaneId: leaf.id,
  };
}

export function allLeavesInTab(
  windows: WindowState[],
): ReturnType<typeof allLeaves> {
  return windows.flatMap((ws) => allLeaves(ws.paneTree));
}

export function findWindowContainingPane(
  windows: WindowState[],
  paneId: string,
): WindowState | undefined {
  return windows.find((ws) =>
    allLeaves(ws.paneTree).some((leaf) => leaf.id === paneId),
  );
}
