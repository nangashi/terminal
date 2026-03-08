import { describe, it, expect } from "vitest";
import {
  createWindowState,
  allLeavesInTab,
  findWindowContainingPane,
  WindowState,
} from "./windowHelpers";
import { allLeaves } from "./paneTree";

describe("windowHelpers", () => {
  describe("createWindowState", () => {
    it("creates a window with a single leaf pane", () => {
      const ws = createWindowState("Window 1");
      expect(ws.window.title).toBe("Window 1");
      expect(ws.window.id).toBeTruthy();
      expect(ws.paneTree.type).toBe("leaf");
      expect(ws.activePaneId).toBe(ws.paneTree.id);
    });

    it("passes initialCwd to the leaf", () => {
      const ws = createWindowState("Window 1", "/tmp");
      expect(ws.paneTree.type).toBe("leaf");
      if (ws.paneTree.type === "leaf") {
        expect(ws.paneTree.initialCwd).toBe("/tmp");
      }
    });
  });

  describe("allLeavesInTab", () => {
    it("returns leaves from all windows", () => {
      const ws1 = createWindowState("W1");
      const ws2 = createWindowState("W2");
      const leaves = allLeavesInTab([ws1, ws2]);
      expect(leaves).toHaveLength(2);
      expect(leaves[0].id).toBe(allLeaves(ws1.paneTree)[0].id);
      expect(leaves[1].id).toBe(allLeaves(ws2.paneTree)[0].id);
    });

    it("returns empty array for no windows", () => {
      expect(allLeavesInTab([])).toHaveLength(0);
    });
  });

  describe("findWindowContainingPane", () => {
    it("finds the window containing the pane", () => {
      const ws1 = createWindowState("W1");
      const ws2 = createWindowState("W2");
      const windows: WindowState[] = [ws1, ws2];
      const paneId = allLeaves(ws2.paneTree)[0].id;
      const found = findWindowContainingPane(windows, paneId);
      expect(found).toBe(ws2);
    });

    it("returns undefined for unknown pane", () => {
      const ws1 = createWindowState("W1");
      const found = findWindowContainingPane([ws1], "nonexistent");
      expect(found).toBeUndefined();
    });
  });
});
