import { PaneNode, PaneLeaf, PaneSplit, SplitDirection } from "../types";

export function createLeaf(initialCwd?: string): PaneLeaf {
  return { type: "leaf", id: crypto.randomUUID(), ptyId: null, initialCwd };
}

export function splitPane(
  tree: PaneNode,
  targetPaneId: string,
  direction: SplitDirection,
  initialCwd?: string,
): { tree: PaneNode; newPaneId: string } | null {
  const newLeaf = createLeaf(initialCwd);

  function walk(node: PaneNode): PaneNode | null {
    if (node.type === "leaf") {
      if (node.id === targetPaneId) {
        const split: PaneSplit = {
          type: "split",
          id: crypto.randomUUID(),
          direction,
          ratio: 0.5,
          first: node,
          second: newLeaf,
        };
        return split;
      }
      return null;
    }

    const firstResult = walk(node.first);
    if (firstResult) return { ...node, first: firstResult };

    const secondResult = walk(node.second);
    if (secondResult) return { ...node, second: secondResult };

    return null;
  }

  const result = walk(tree);
  if (!result) return null;
  return { tree: result, newPaneId: newLeaf.id };
}

export function closePane(
  tree: PaneNode,
  targetPaneId: string,
): PaneNode | null {
  if (tree.type === "leaf") {
    return tree.id === targetPaneId ? null : tree;
  }

  if (tree.first.type === "leaf" && tree.first.id === targetPaneId) {
    return tree.second;
  }
  if (tree.second.type === "leaf" && tree.second.id === targetPaneId) {
    return tree.first;
  }

  const firstResult = closePane(tree.first, targetPaneId);
  if (firstResult !== tree.first) {
    if (firstResult === null) return tree.second;
    return { ...tree, first: firstResult };
  }

  const secondResult = closePane(tree.second, targetPaneId);
  if (secondResult !== tree.second) {
    if (secondResult === null) return tree.first;
    return { ...tree, second: secondResult };
  }

  return tree;
}

export function findSplitNode(
  tree: PaneNode,
  splitNodeId: string,
): PaneSplit | null {
  if (tree.type === "leaf") return null;
  if (tree.id === splitNodeId) return tree;
  return (
    findSplitNode(tree.first, splitNodeId) ??
    findSplitNode(tree.second, splitNodeId)
  );
}

export function findLeaf(tree: PaneNode, paneId: string): PaneLeaf | undefined {
  if (tree.type === "leaf") {
    return tree.id === paneId ? tree : undefined;
  }
  return findLeaf(tree.first, paneId) ?? findLeaf(tree.second, paneId);
}

export function allLeaves(tree: PaneNode): PaneLeaf[] {
  if (tree.type === "leaf") return [tree];
  return [...allLeaves(tree.first), ...allLeaves(tree.second)];
}

export function updateLeafPtyId(
  tree: PaneNode,
  paneId: string,
  ptyId: number,
): PaneNode {
  if (tree.type === "leaf") {
    return tree.id === paneId ? { ...tree, ptyId } : tree;
  }
  const first = updateLeafPtyId(tree.first, paneId, ptyId);
  const second = updateLeafPtyId(tree.second, paneId, ptyId);
  if (first === tree.first && second === tree.second) return tree;
  return { ...tree, first, second };
}

export function updateRatio(
  tree: PaneNode,
  splitNodeId: string,
  ratio: number,
): PaneNode {
  if (tree.type === "leaf") return tree;
  if (tree.id === splitNodeId) {
    const clamped = Math.max(0.1, Math.min(0.9, ratio));
    return { ...tree, ratio: clamped };
  }
  const first = updateRatio(tree.first, splitNodeId, ratio);
  const second = updateRatio(tree.second, splitNodeId, ratio);
  if (first === tree.first && second === tree.second) return tree;
  return { ...tree, first, second };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LeafRect {
  paneId: string;
  rect: Rect;
}

export interface DividerRect {
  splitId: string;
  direction: SplitDirection;
  rect: Rect;
}

export const DIVIDER_SIZE = 4; // px - must match CSS

export function computeLeafRects(
  node: PaneNode,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
  containerSize?: { width: number; height: number },
): LeafRect[] {
  if (node.type === "leaf") {
    return [{ paneId: node.id, rect }];
  }
  // Only subtract divider px when a real container size is provided
  const dividerW =
    containerSize && node.direction === "vertical"
      ? DIVIDER_SIZE / containerSize.width
      : 0;
  const dividerH =
    containerSize && node.direction === "horizontal"
      ? DIVIDER_SIZE / containerSize.height
      : 0;

  if (node.direction === "vertical") {
    const usable = rect.w - dividerW;
    const firstW = usable * node.ratio;
    const secondW = usable - firstW;
    return [
      ...computeLeafRects(node.first, { ...rect, w: firstW }, containerSize),
      ...computeLeafRects(
        node.second,
        { ...rect, x: rect.x + firstW + dividerW, w: secondW },
        containerSize,
      ),
    ];
  } else {
    const usable = rect.h - dividerH;
    const firstH = usable * node.ratio;
    const secondH = usable - firstH;
    return [
      ...computeLeafRects(node.first, { ...rect, h: firstH }, containerSize),
      ...computeLeafRects(
        node.second,
        { ...rect, y: rect.y + firstH + dividerH, h: secondH },
        containerSize,
      ),
    ];
  }
}

export function computeDividerRects(
  node: PaneNode,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
): DividerRect[] {
  if (node.type === "leaf") return [];
  if (node.direction === "vertical") {
    const splitX = rect.x + rect.w * node.ratio;
    return [
      {
        splitId: node.id,
        direction: "vertical",
        rect: { x: splitX, y: rect.y, w: 0, h: rect.h },
      },
      ...computeDividerRects(node.first, {
        ...rect,
        w: rect.w * node.ratio,
      }),
      ...computeDividerRects(node.second, {
        x: splitX,
        y: rect.y,
        w: rect.w * (1 - node.ratio),
        h: rect.h,
      }),
    ];
  } else {
    const splitY = rect.y + rect.h * node.ratio;
    return [
      {
        splitId: node.id,
        direction: "horizontal",
        rect: { x: rect.x, y: splitY, w: rect.w, h: 0 },
      },
      ...computeDividerRects(node.first, {
        ...rect,
        h: rect.h * node.ratio,
      }),
      ...computeDividerRects(node.second, {
        x: rect.x,
        y: splitY,
        w: rect.w,
        h: rect.h * (1 - node.ratio),
      }),
    ];
  }
}

type NavigationDirection = "left" | "right" | "up" | "down";

function rangesOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): boolean {
  const EPS = 1e-9;
  return a0 < b1 - EPS && b0 < a1 - EPS;
}

export function findAdjacentPane(
  tree: PaneNode,
  paneId: string,
  direction: NavigationDirection,
): string | null {
  const rects = computeLeafRects(tree);
  const current = rects.find((r) => r.paneId === paneId);
  if (!current) return null;

  const cr = current.rect;
  const cx = cr.x + cr.w / 2;
  const cy = cr.y + cr.h / 2;
  const isHorizontalNav = direction === "left" || direction === "right";

  let best: string | null = null;
  let bestDist = Infinity;
  let bestOverlaps = false;

  for (const lr of rects) {
    if (lr.paneId === paneId) continue;
    const or_ = lr.rect;
    const ox = or_.x + or_.w / 2;
    const oy = or_.y + or_.h / 2;

    let valid = false;
    switch (direction) {
      case "left":
        valid = ox < cx;
        break;
      case "right":
        valid = ox > cx;
        break;
      case "up":
        valid = oy < cy;
        break;
      case "down":
        valid = oy > cy;
        break;
    }
    if (!valid) continue;

    // Check if panes overlap on the perpendicular axis
    const overlaps = isHorizontalNav
      ? rangesOverlap(cr.y, cr.y + cr.h, or_.y, or_.y + or_.h)
      : rangesOverlap(cr.x, cr.x + cr.w, or_.x, or_.x + or_.w);

    const dist = Math.abs(ox - cx) + Math.abs(oy - cy);

    // Prefer overlapping panes; among same overlap status, prefer closer
    if (
      (overlaps && !bestOverlaps) ||
      (overlaps === bestOverlaps && dist < bestDist)
    ) {
      bestDist = dist;
      best = lr.paneId;
      bestOverlaps = overlaps;
    }
  }

  return best;
}

export function findParentSplit(
  tree: PaneNode,
  paneId: string,
  direction: NavigationDirection,
): { splitId: string; delta: number } | null {
  if (tree.type === "leaf") return null;

  const isInFirst = findLeaf(tree.first, paneId) !== undefined;

  if (!isInFirst && findLeaf(tree.second, paneId) === undefined) return null;

  const matchesDirection =
    (tree.direction === "vertical" &&
      (direction === "left" || direction === "right")) ||
    (tree.direction === "horizontal" &&
      (direction === "up" || direction === "down"));

  if (matchesDirection) {
    const delta = direction === "left" || direction === "up" ? -0.05 : 0.05;
    return { splitId: tree.id, delta };
  }

  if (isInFirst) return findParentSplit(tree.first, paneId, direction);
  return findParentSplit(tree.second, paneId, direction);
}
