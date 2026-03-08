import { PaneNode, Window } from "../types";
import { createLeaf, allLeaves } from "./paneTree";

export interface WindowState {
  window: Window;
  paneTree: PaneNode;
  activePaneId: string;
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
