import { describe, it, expect } from "vitest";
import {
  applySplit,
  applyNavigate,
  applyResize,
  applyCreateWindow,
  applySwitchWindow,
  applySelectPane,
} from "./tabStateActions";
import { createWindowState } from "./windowHelpers";
import { TabState } from "../types";
import { allLeaves } from "./paneTree";

function createTabState(windowCount = 1): TabState {
  const windows = Array.from({ length: windowCount }, (_, i) =>
    createWindowState(`Window ${i + 1}`),
  );
  return {
    tab: { id: "tab-1", title: "Tab 1" },
    windows,
    activeWindowId: windows[0].window.id,
    nextWindowNum: windowCount + 1,
  };
}

describe("tabStateActions", () => {
  describe("applySplit", () => {
    it("splits the active pane horizontally", () => {
      const ts = createTabState();
      const windowId = ts.windows[0].window.id;
      const result = applySplit(ts, windowId, "horizontal");
      const leaves = allLeaves(result.windows[0].paneTree);
      expect(leaves).toHaveLength(2);
      expect(result.windows[0].activePaneId).toBe(leaves[1].id);
    });

    it("splits the active pane vertically", () => {
      const ts = createTabState();
      const windowId = ts.windows[0].window.id;
      const result = applySplit(ts, windowId, "vertical");
      const leaves = allLeaves(result.windows[0].paneTree);
      expect(leaves).toHaveLength(2);
      expect(result.windows[0].paneTree.type).toBe("split");
    });

    it("passes initial cwd to new pane", () => {
      const ts = createTabState();
      const windowId = ts.windows[0].window.id;
      const result = applySplit(ts, windowId, "vertical", "/home");
      const leaves = allLeaves(result.windows[0].paneTree);
      expect(leaves[1].initialCwd).toBe("/home");
    });

    it("returns unchanged state for unknown windowId", () => {
      const ts = createTabState();
      const result = applySplit(ts, "unknown", "horizontal");
      expect(result).toBe(ts);
    });
  });

  describe("applyNavigate", () => {
    it("navigates to adjacent pane", () => {
      const ts = createTabState();
      const windowId = ts.windows[0].window.id;
      const split = applySplit(ts, windowId, "vertical");
      const leaves = allLeaves(split.windows[0].paneTree);
      // active is leaves[1] (new pane), navigate left → leaves[0]
      const result = applyNavigate(split, windowId, leaves[1].id, "left");
      expect(result.windows[0].activePaneId).toBe(leaves[0].id);
    });

    it("returns unchanged state when no adjacent pane", () => {
      const ts = createTabState();
      const windowId = ts.windows[0].window.id;
      const result = applyNavigate(
        ts,
        windowId,
        ts.windows[0].activePaneId,
        "left",
      );
      expect(result).toBe(ts);
    });

    it("returns unchanged state for unknown windowId", () => {
      const ts = createTabState();
      const result = applyNavigate(ts, "unknown", "pane-1", "right");
      expect(result).toBe(ts);
    });
  });

  describe("applyResize", () => {
    it("resizes split ratio in the correct direction", () => {
      const ts = createTabState();
      const windowId = ts.windows[0].window.id;
      const split = applySplit(ts, windowId, "vertical");
      const leaves = allLeaves(split.windows[0].paneTree);
      // resize-right from left pane → ratio increases
      const result = applyResize(split, windowId, leaves[0].id, "right");
      const tree = result.windows[0].paneTree;
      expect(tree.type).toBe("split");
      if (tree.type === "split") {
        expect(tree.ratio).toBeGreaterThan(0.5);
      }
    });

    it("resizes split ratio in the opposite direction", () => {
      const ts = createTabState();
      const windowId = ts.windows[0].window.id;
      const split = applySplit(ts, windowId, "vertical");
      const leaves = allLeaves(split.windows[0].paneTree);
      // resize-left from left pane → ratio decreases
      const result = applyResize(split, windowId, leaves[0].id, "left");
      const tree = result.windows[0].paneTree;
      expect(tree.type).toBe("split");
      if (tree.type === "split") {
        expect(tree.ratio).toBeLessThan(0.5);
      }
    });

    it("returns unchanged state for perpendicular direction", () => {
      const ts = createTabState();
      const windowId = ts.windows[0].window.id;
      const split = applySplit(ts, windowId, "vertical");
      const leaves = allLeaves(split.windows[0].paneTree);
      // vertical split, resize up → no matching parent split
      const result = applyResize(split, windowId, leaves[0].id, "up");
      expect(result).toBe(split);
    });

    it("returns unchanged state for unknown windowId", () => {
      const ts = createTabState();
      const result = applyResize(ts, "unknown", "pane-1", "right");
      expect(result).toBe(ts);
    });
  });

  describe("applyCreateWindow", () => {
    it("adds a new window and sets it as active", () => {
      const ts = createTabState();
      const result = applyCreateWindow(ts);
      expect(result.windows).toHaveLength(2);
      expect(result.activeWindowId).toBe(result.windows[1].window.id);
    });

    it("increments nextWindowNum", () => {
      const ts = createTabState();
      const result = applyCreateWindow(ts);
      expect(result.nextWindowNum).toBe(ts.nextWindowNum + 1);
    });

    it("sets the window title using nextWindowNum", () => {
      const ts = createTabState();
      const result = applyCreateWindow(ts);
      expect(result.windows[1].window.title).toBe(`Window ${ts.nextWindowNum}`);
    });

    it("passes cwd to the new window pane", () => {
      const ts = createTabState();
      const result = applyCreateWindow(ts, "/tmp");
      const newLeaf = allLeaves(result.windows[1].paneTree)[0];
      expect(newLeaf.initialCwd).toBe("/tmp");
    });
  });

  describe("applySwitchWindow", () => {
    it("switches to next window", () => {
      const ts = createTabState(2);
      const result = applySwitchWindow(ts, 1);
      expect(result.activeWindowId).toBe(ts.windows[1].window.id);
    });

    it("switches to previous window", () => {
      const ts = createTabState(2);
      // Set active to second window
      const ts2 = { ...ts, activeWindowId: ts.windows[1].window.id };
      const result = applySwitchWindow(ts2, -1);
      expect(result.activeWindowId).toBe(ts.windows[0].window.id);
    });

    it("wraps around from last to first", () => {
      const ts = createTabState(2);
      const ts2 = { ...ts, activeWindowId: ts.windows[1].window.id };
      const result = applySwitchWindow(ts2, 1);
      expect(result.activeWindowId).toBe(ts.windows[0].window.id);
    });

    it("wraps around from first to last", () => {
      const ts = createTabState(2);
      const result = applySwitchWindow(ts, -1);
      expect(result.activeWindowId).toBe(ts.windows[1].window.id);
    });

    it("returns unchanged state when only one window", () => {
      const ts = createTabState(1);
      const result = applySwitchWindow(ts, 1);
      expect(result).toBe(ts);
    });
  });

  describe("applySelectPane", () => {
    it("selects pane by index within single window", () => {
      const ts = createTabState();
      const windowId = ts.windows[0].window.id;
      const split = applySplit(ts, windowId, "vertical");
      const leaves = allLeaves(split.windows[0].paneTree);
      const result = applySelectPane(split, 0);
      expect(result.windows[0].activePaneId).toBe(leaves[0].id);
    });

    it("selects pane across windows", () => {
      const ts = createTabState(2);
      // Window 0 has 1 pane (index 0), Window 1 has 1 pane (index 1)
      const result = applySelectPane(ts, 1);
      expect(result.activeWindowId).toBe(ts.windows[1].window.id);
      expect(result.windows[1].activePaneId).toBe(
        allLeaves(ts.windows[1].paneTree)[0].id,
      );
    });

    it("switches activeWindowId when selecting pane in different window", () => {
      const ts = createTabState(2);
      const result = applySelectPane(ts, 1);
      expect(result.activeWindowId).toBe(ts.windows[1].window.id);
    });

    it("returns unchanged state for out-of-range index", () => {
      const ts = createTabState();
      const result = applySelectPane(ts, 99);
      expect(result).toBe(ts);
    });

    it("returns unchanged state for negative index", () => {
      const ts = createTabState();
      const result = applySelectPane(ts, -1);
      expect(result).toBe(ts);
    });

    it("handles multi-pane multi-window correctly", () => {
      // Window 0: split into 2 panes, Window 1: 1 pane
      const base = createTabState(2);
      const windowId = base.windows[0].window.id;
      const ts = applySplit(base, windowId, "vertical");
      // Panes: [win0-pane0, win0-pane1, win1-pane0]
      const win1Pane = allLeaves(ts.windows[1].paneTree)[0];
      const result = applySelectPane(ts, 2);
      expect(result.activeWindowId).toBe(ts.windows[1].window.id);
      expect(result.windows[1].activePaneId).toBe(win1Pane.id);
    });
  });
});
