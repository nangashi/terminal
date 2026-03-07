export interface Tab {
  id: string;
  title: string;
}

export type SplitDirection = "horizontal" | "vertical";

export interface PaneLeaf {
  type: "leaf";
  id: string;
  ptyId: number | null;
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
