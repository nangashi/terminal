import { describe, it, expect } from "vitest";
import {
  createLeaf,
  splitPane,
  closePane,
  findLeaf,
  findSplitNode,
  allLeaves,
  updateLeafPtyId,
  updateRatio,
  findAdjacentPane,
  findParentSplit,
  computeLeafRects,
  computeDividerRects,
  DIVIDER_SIZE,
} from "./paneTree";
import { PaneNode } from "../types";

describe("paneTree", () => {
  describe("createLeaf", () => {
    it("creates a leaf with unique id and null ptyId", () => {
      const leaf = createLeaf();
      expect(leaf.type).toBe("leaf");
      expect(leaf.id).toBeTruthy();
      expect(leaf.ptyId).toBeNull();
    });

    it("creates unique ids", () => {
      const a = createLeaf();
      const b = createLeaf();
      expect(a.id).not.toBe(b.id);
    });
  });

  describe("splitPane", () => {
    it("splits a single leaf horizontally", () => {
      const leaf = createLeaf();
      const result = splitPane(leaf, leaf.id, "horizontal");
      expect(result).not.toBeNull();
      expect(result!.tree.type).toBe("split");
      const split = result!.tree as Extract<PaneNode, { type: "split" }>;
      expect(split.direction).toBe("horizontal");
      expect(split.ratio).toBe(0.5);
      expect(split.first).toBe(leaf);
      expect(split.second.type).toBe("leaf");
      expect(result!.newPaneId).toBe(split.second.id);
    });

    it("splits a leaf vertically in a nested tree", () => {
      const leaf = createLeaf();
      const first = splitPane(leaf, leaf.id, "horizontal")!;
      const secondLeaf = allLeaves(first.tree)[1];
      const result = splitPane(first.tree, secondLeaf.id, "vertical");
      expect(result).not.toBeNull();
      expect(allLeaves(result!.tree)).toHaveLength(3);
    });

    it("returns null for non-existent pane id", () => {
      const leaf = createLeaf();
      const result = splitPane(leaf, "non-existent", "horizontal");
      expect(result).toBeNull();
    });
  });

  describe("closePane", () => {
    it("returns null when closing the only leaf", () => {
      const leaf = createLeaf();
      expect(closePane(leaf, leaf.id)).toBeNull();
    });

    it("returns sibling when closing one of two panes", () => {
      const leaf = createLeaf();
      const { tree } = splitPane(leaf, leaf.id, "horizontal")!;
      const leaves = allLeaves(tree);
      const result = closePane(tree, leaves[0].id);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("leaf");
      expect(result!.id).toBe(leaves[1].id);
    });

    it("preserves tree when pane id not found", () => {
      const leaf = createLeaf();
      const result = closePane(leaf, "non-existent");
      expect(result).toBe(leaf);
    });

    it("handles deeply nested close", () => {
      const leaf = createLeaf();
      let { tree } = splitPane(leaf, leaf.id, "horizontal")!;
      const leaves1 = allLeaves(tree);
      const result2 = splitPane(tree, leaves1[1].id, "vertical")!;
      tree = result2.tree;
      expect(allLeaves(tree)).toHaveLength(3);
      tree = closePane(tree, result2.newPaneId)!;
      expect(allLeaves(tree)).toHaveLength(2);
    });
  });

  describe("findLeaf", () => {
    it("finds a leaf in a single-leaf tree", () => {
      const leaf = createLeaf();
      expect(findLeaf(leaf, leaf.id)).toBe(leaf);
    });

    it("returns undefined for non-existent id", () => {
      const leaf = createLeaf();
      expect(findLeaf(leaf, "nope")).toBeUndefined();
    });
  });

  describe("allLeaves", () => {
    it("returns single leaf for leaf node", () => {
      const leaf = createLeaf();
      expect(allLeaves(leaf)).toEqual([leaf]);
    });

    it("returns all leaves in tree order", () => {
      const leaf = createLeaf();
      const { tree } = splitPane(leaf, leaf.id, "horizontal")!;
      const leaves = allLeaves(tree);
      expect(leaves).toHaveLength(2);
      expect(leaves[0].id).toBe(leaf.id);
    });
  });

  describe("updateLeafPtyId", () => {
    it("updates ptyId for matching leaf", () => {
      const leaf = createLeaf();
      const updated = updateLeafPtyId(leaf, leaf.id, 42);
      expect(updated.type).toBe("leaf");
      expect((updated as Extract<PaneNode, { type: "leaf" }>).ptyId).toBe(42);
    });

    it("returns same node for non-matching id", () => {
      const leaf = createLeaf();
      const result = updateLeafPtyId(leaf, "nope", 42);
      expect(result).toBe(leaf);
    });
  });

  describe("updateRatio", () => {
    it("updates ratio for matching split", () => {
      const leaf = createLeaf();
      const { tree } = splitPane(leaf, leaf.id, "horizontal")!;
      const split = tree as Extract<PaneNode, { type: "split" }>;
      const updated = updateRatio(tree, split.id, 0.7);
      expect(
        (updated as Extract<PaneNode, { type: "split" }>).ratio,
      ).toBeCloseTo(0.7);
    });

    it("clamps ratio to [0.1, 0.9]", () => {
      const leaf = createLeaf();
      const { tree } = splitPane(leaf, leaf.id, "horizontal")!;
      const split = tree as Extract<PaneNode, { type: "split" }>;
      const low = updateRatio(tree, split.id, 0.0);
      expect((low as Extract<PaneNode, { type: "split" }>).ratio).toBeCloseTo(
        0.1,
      );
      const high = updateRatio(tree, split.id, 1.0);
      expect((high as Extract<PaneNode, { type: "split" }>).ratio).toBeCloseTo(
        0.9,
      );
    });
  });

  describe("findAdjacentPane", () => {
    it("finds right pane in a vertical split", () => {
      const leaf = createLeaf();
      const { tree } = splitPane(leaf, leaf.id, "vertical")!;
      const leaves = allLeaves(tree);
      expect(findAdjacentPane(tree, leaves[0].id, "right")).toBe(leaves[1].id);
      expect(findAdjacentPane(tree, leaves[1].id, "left")).toBe(leaves[0].id);
    });

    it("finds down pane in a horizontal split", () => {
      const leaf = createLeaf();
      const { tree } = splitPane(leaf, leaf.id, "horizontal")!;
      const leaves = allLeaves(tree);
      expect(findAdjacentPane(tree, leaves[0].id, "down")).toBe(leaves[1].id);
      expect(findAdjacentPane(tree, leaves[1].id, "up")).toBe(leaves[0].id);
    });

    it("returns null when no pane in direction", () => {
      const leaf = createLeaf();
      const { tree } = splitPane(leaf, leaf.id, "vertical")!;
      const leaves = allLeaves(tree);
      expect(findAdjacentPane(tree, leaves[0].id, "left")).toBeNull();
    });

    it("navigates left from a deeply nested right pane to the left column", () => {
      // Build: horizontal split → top split vertical → top-right split H twice
      // Layout:
      //  TL     | TR1
      //         | TR2
      //         | TR3
      //  -------+----
      //     bottom
      const root = createLeaf();
      // 1. horizontal split → top, bottom
      let tree = splitPane(root, root.id, "horizontal")!.tree;
      const top = allLeaves(tree)[0];
      // 2. top → vertical split → TL, TR
      tree = splitPane(tree, top.id, "vertical")!.tree;
      const tr = allLeaves(tree)[1]; // top-right
      // 3. TR → horizontal split → TR1, TR-rest
      tree = splitPane(tree, tr.id, "horizontal")!.tree;
      const trRest = allLeaves(tree)[2]; // second child of TR split
      // 4. TR-rest → horizontal split → TR2, TR3
      tree = splitPane(tree, trRest.id, "horizontal")!.tree;

      const leaves = allLeaves(tree);
      // leaves: [TL, TR1, TR2, TR3, bottom]
      const tl = leaves[0];
      const tr3 = leaves[3];

      // From TR3, pressing left should go to TL (not bottom)
      expect(findAdjacentPane(tree, tr3.id, "left")).toBe(tl.id);
    });
  });

  describe("findParentSplit", () => {
    it("finds parent split for resize", () => {
      const leaf = createLeaf();
      const { tree } = splitPane(leaf, leaf.id, "vertical")!;
      const leaves = allLeaves(tree);
      const result = findParentSplit(tree, leaves[0].id, "right");
      expect(result).not.toBeNull();
      expect(result!.delta).toBeCloseTo(0.05);
    });

    it("returns null for perpendicular direction", () => {
      const leaf = createLeaf();
      const { tree } = splitPane(leaf, leaf.id, "vertical")!;
      const leaves = allLeaves(tree);
      expect(findParentSplit(tree, leaves[0].id, "up")).toBeNull();
    });
  });

  describe("computeLeafRects", () => {
    it("returns a single rect for a leaf", () => {
      const leaf = createLeaf();
      const rects = computeLeafRects(leaf);
      expect(rects).toHaveLength(1);
      expect(rects[0].paneId).toBe(leaf.id);
      expect(rects[0].rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    });

    it("splits area for a vertical split without container size", () => {
      const leaf = createLeaf();
      const { tree } = splitPane(leaf, leaf.id, "vertical")!;
      const rects = computeLeafRects(tree);
      expect(rects).toHaveLength(2);
      // Without containerSize, divider width is 0, so each pane gets ratio * total
      expect(rects[0].rect.w).toBeCloseTo(0.5);
      expect(rects[1].rect.w).toBeCloseTo(0.5);
      expect(rects[1].rect.x).toBeCloseTo(0.5);
    });

    it("subtracts divider size when container size is provided", () => {
      const leaf = createLeaf();
      const { tree } = splitPane(leaf, leaf.id, "vertical")!;
      const containerSize = { width: 1000, height: 500 };
      const rects = computeLeafRects(tree, undefined, containerSize);
      const dividerFraction = DIVIDER_SIZE / containerSize.width;
      const usable = 1 - dividerFraction;
      expect(rects[0].rect.w).toBeCloseTo(usable * 0.5);
      expect(rects[1].rect.x).toBeCloseTo(usable * 0.5 + dividerFraction);
    });
  });

  describe("computeDividerRects", () => {
    it("returns empty for a leaf", () => {
      const leaf = createLeaf();
      expect(computeDividerRects(leaf)).toEqual([]);
    });

    it("returns one divider for a split", () => {
      const leaf = createLeaf();
      const { tree } = splitPane(leaf, leaf.id, "horizontal")!;
      const dividers = computeDividerRects(tree);
      expect(dividers).toHaveLength(1);
      expect(dividers[0].direction).toBe("horizontal");
      expect(dividers[0].rect.y).toBeCloseTo(0.5);
    });

    it("returns multiple dividers for nested splits", () => {
      const leaf = createLeaf();
      let { tree } = splitPane(leaf, leaf.id, "vertical")!;
      const leaves = allLeaves(tree);
      tree = splitPane(tree, leaves[1].id, "horizontal")!.tree;
      const dividers = computeDividerRects(tree);
      expect(dividers).toHaveLength(2);
    });
  });

  describe("findSplitNode", () => {
    it("finds a split node by id", () => {
      const leaf = createLeaf();
      const { tree } = splitPane(leaf, leaf.id, "horizontal")!;
      const split = tree as Extract<PaneNode, { type: "split" }>;
      expect(findSplitNode(tree, split.id)).toBe(split);
    });

    it("returns null for non-existent id", () => {
      const leaf = createLeaf();
      expect(findSplitNode(leaf, "nope")).toBeNull();
    });

    it("returns null for leaf node", () => {
      const leaf = createLeaf();
      expect(findSplitNode(leaf, leaf.id)).toBeNull();
    });
  });
});
