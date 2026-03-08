import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar, PaneInfo, WindowInfo } from "./Sidebar";
import { PaneMetadata } from "../hooks/usePaneMetadata";
import { ClaudeState } from "../hooks/useClaudeStatus";

const emptyMetadata = new Map<string, PaneMetadata>();
const emptyClaudeStatus = new Map<string, ClaudeState>();

function makePanes(count: number, activeIndex = 0): PaneInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `pane-${i + 1}`,
    index: i + 1,
    isActive: i === activeIndex,
    windowId: "win-1",
  }));
}

function makeWindows(count: number, activeIndex = 0): WindowInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `win-${i + 1}`,
    title: `Window ${i + 1}`,
    isActive: i === activeIndex,
  }));
}

describe("Sidebar", () => {
  it("renders pane list items without metadata", () => {
    render(
      <Sidebar
        panes={makePanes(3)}
        windows={makeWindows(1)}
        metadata={emptyMetadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={() => {}}
      />,
    );
    const skeletons = document.querySelectorAll(
      ".pane-list-item__label--skeleton",
    );
    expect(skeletons.length).toBe(3);
  });

  it("renders index numbers", () => {
    render(
      <Sidebar
        panes={makePanes(3)}
        windows={makeWindows(1)}
        metadata={emptyMetadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={() => {}}
      />,
    );
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("highlights active pane", () => {
    render(
      <Sidebar
        panes={makePanes(3, 1)}
        windows={makeWindows(1)}
        metadata={emptyMetadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={() => {}}
      />,
    );
    const items = document.querySelectorAll(".pane-list-item");
    expect(items[0].classList.contains("pane-list-item--active")).toBe(false);
    expect(items[1].classList.contains("pane-list-item--active")).toBe(true);
    expect(items[2].classList.contains("pane-list-item--active")).toBe(false);
  });

  it("calls onSelectPane when clicked", () => {
    const onSelectPane = vi.fn();
    render(
      <Sidebar
        panes={makePanes(3)}
        windows={makeWindows(1)}
        metadata={emptyMetadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={onSelectPane}
      />,
    );
    const items = document.querySelectorAll(".pane-list-item");
    fireEvent.click(items[1]);
    expect(onSelectPane).toHaveBeenCalledWith("pane-2");
  });

  it("displays git repo name and branch from metadata", () => {
    const metadata = new Map<string, PaneMetadata>([
      [
        "pane-1",
        {
          cwd: "/home/user/terminal",
          git: { repoName: "terminal", branch: "main", isDirty: false },
        },
      ],
    ]);
    render(
      <Sidebar
        panes={makePanes(1)}
        windows={makeWindows(1)}
        metadata={metadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={() => {}}
      />,
    );
    expect(screen.getByText("terminal")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
  });

  it("displays directory name when no git info", () => {
    const metadata = new Map<string, PaneMetadata>([
      ["pane-1", { cwd: "/home/user/projects/myapp", git: null }],
    ]);
    render(
      <Sidebar
        panes={makePanes(1)}
        windows={makeWindows(1)}
        metadata={metadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={() => {}}
      />,
    );
    expect(screen.getByText("myapp")).toBeTruthy();
  });

  it("marks dirty branch with CSS class", () => {
    const metadata = new Map<string, PaneMetadata>([
      [
        "pane-1",
        {
          cwd: "/home/user/terminal",
          git: { repoName: "terminal", branch: "dev", isDirty: true },
        },
      ],
    ]);
    render(
      <Sidebar
        panes={makePanes(1)}
        windows={makeWindows(1)}
        metadata={metadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={() => {}}
      />,
    );
    const branchEl = screen.getByText(/^dev/);
    expect(branchEl.classList.contains("pane-list-item__branch--dirty")).toBe(
      true,
    );
    expect(branchEl.querySelector(".pane-list-item__dirty")).toBeTruthy();
  });

  it("does not show dirty marker for clean branch", () => {
    const metadata = new Map<string, PaneMetadata>([
      [
        "pane-1",
        {
          cwd: "/home/user/terminal",
          git: { repoName: "terminal", branch: "main", isDirty: false },
        },
      ],
    ]);
    render(
      <Sidebar
        panes={makePanes(1)}
        windows={makeWindows(1)}
        metadata={metadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={() => {}}
      />,
    );
    const branchEl = screen.getByText("main");
    expect(branchEl.querySelector(".pane-list-item__dirty")).toBeNull();
  });

  it("displays shortened cwd path", () => {
    const metadata = new Map<string, PaneMetadata>([
      [
        "pane-1",
        {
          cwd: "/home/user/projects/myapp",
          git: null,
        },
      ],
    ]);
    render(
      <Sidebar
        panes={makePanes(1)}
        windows={makeWindows(1)}
        metadata={metadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={() => {}}
      />,
    );
    expect(screen.getByText("~/projects/myapp")).toBeTruthy();
  });

  it("displays cwd under /root as ~", () => {
    const metadata = new Map<string, PaneMetadata>([
      [
        "pane-1",
        {
          cwd: "/root/work",
          git: null,
        },
      ],
    ]);
    render(
      <Sidebar
        panes={makePanes(1)}
        windows={makeWindows(1)}
        metadata={metadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={() => {}}
      />,
    );
    expect(screen.getByText("~/work")).toBeTruthy();
  });

  it("does not show claude indicator when claudeStatus is empty", () => {
    render(
      <Sidebar
        panes={makePanes(1)}
        windows={makeWindows(1)}
        metadata={emptyMetadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={() => {}}
      />,
    );
    expect(document.querySelector(".pane-list-item__claude")).toBeNull();
  });

  it("shows working indicator with animated dots", () => {
    const claudeStatus = new Map<string, ClaudeState>([
      ["pane-1", { status: "working" }],
    ]);
    render(
      <Sidebar
        panes={makePanes(1)}
        windows={makeWindows(1)}
        metadata={emptyMetadata}
        claudeStatus={claudeStatus}
        onSelectPane={() => {}}
      />,
    );
    const indicator = document.querySelector(".pane-list-item__claude-working");
    expect(indicator).toBeTruthy();
    const dots = document.querySelectorAll(".pane-list-item__claude-dot");
    expect(dots.length).toBe(3);
    expect(screen.getByText("\uD83E\uDD16")).toBeTruthy();
  });

  it("shows idle indicator with text", () => {
    const claudeStatus = new Map<string, ClaudeState>([
      ["pane-1", { status: "idle" }],
    ]);
    render(
      <Sidebar
        panes={makePanes(1)}
        windows={makeWindows(1)}
        metadata={emptyMetadata}
        claudeStatus={claudeStatus}
        onSelectPane={() => {}}
      />,
    );
    const indicator = document.querySelector(".pane-list-item__claude-idle");
    expect(indicator).toBeTruthy();
    expect(screen.getByText("\u5F85\u6A5F")).toBeTruthy();
    expect(screen.getByText("\uD83E\uDD16")).toBeTruthy();
  });

  it("does not show window headers with single window", () => {
    render(
      <Sidebar
        panes={makePanes(2)}
        windows={makeWindows(1)}
        metadata={emptyMetadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={() => {}}
      />,
    );
    expect(document.querySelector(".sidebar-window-header")).toBeNull();
  });

  it("shows window headers with multiple windows", () => {
    const panes: PaneInfo[] = [
      { id: "pane-1", index: 1, isActive: true, windowId: "win-1" },
      { id: "pane-2", index: 2, isActive: false, windowId: "win-2" },
    ];
    const windows = makeWindows(2);
    render(
      <Sidebar
        panes={panes}
        windows={windows}
        metadata={emptyMetadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={() => {}}
      />,
    );
    const headers = document.querySelectorAll(".sidebar-window-header");
    expect(headers.length).toBe(2);
    expect(headers[0].textContent).toBe("Window 1");
    expect(headers[1].textContent).toBe("Window 2");
  });

  it("highlights active window header", () => {
    const panes: PaneInfo[] = [
      { id: "pane-1", index: 1, isActive: true, windowId: "win-1" },
      { id: "pane-2", index: 2, isActive: false, windowId: "win-2" },
    ];
    const windows = makeWindows(2, 0);
    render(
      <Sidebar
        panes={panes}
        windows={windows}
        metadata={emptyMetadata}
        claudeStatus={emptyClaudeStatus}
        onSelectPane={() => {}}
      />,
    );
    const headers = document.querySelectorAll(".sidebar-window-header");
    expect(headers[0].classList.contains("sidebar-window-header--active")).toBe(
      true,
    );
    expect(headers[1].classList.contains("sidebar-window-header--active")).toBe(
      false,
    );
  });
});
