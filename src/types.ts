export interface Tab {
  id: string;
  title: string;
}

export interface Window {
  id: string;
  title: string;
}

export type SplitDirection = "horizontal" | "vertical";

export interface PaneLeaf {
  type: "leaf";
  id: string;
  ptyId: number | null;
  initialCwd?: string;
}

export interface PaneSplit {
  type: "split";
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: PaneNode;
  second: PaneNode;
}

export type PaneNode = PaneLeaf | PaneSplit;

export interface WindowState {
  window: Window;
  paneTree: PaneNode;
  activePaneId: string;
}

export interface TabState {
  tab: Tab;
  windows: WindowState[];
  activeWindowId: string;
  nextWindowNum: number;
}

export type NavigationDirection = "left" | "right" | "up" | "down";
