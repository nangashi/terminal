import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar, PaneInfo } from "./Sidebar";
import { PaneMetadata } from "../hooks/usePaneMetadata";

const emptyMetadata = new Map<string, PaneMetadata>();

function makePanes(count: number, activeIndex = 0): PaneInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `pane-${i + 1}`,
    index: i + 1,
    isActive: i === activeIndex,
  }));
}

describe("Sidebar", () => {
  it("renders pane list items without metadata", () => {
    render(
      <Sidebar
        panes={makePanes(3)}
        metadata={emptyMetadata}
        onSelectPane={() => {}}
      />,
    );
    expect(screen.getByText("Pane 1")).toBeTruthy();
    expect(screen.getByText("Pane 2")).toBeTruthy();
    expect(screen.getByText("Pane 3")).toBeTruthy();
  });

  it("renders index numbers", () => {
    render(
      <Sidebar
        panes={makePanes(3)}
        metadata={emptyMetadata}
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
        metadata={emptyMetadata}
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
        metadata={emptyMetadata}
        onSelectPane={onSelectPane}
      />,
    );
    fireEvent.click(screen.getByText("Pane 2"));
    expect(onSelectPane).toHaveBeenCalledWith("pane-2");
  });

  it("renders header", () => {
    render(
      <Sidebar
        panes={makePanes(1)}
        metadata={emptyMetadata}
        onSelectPane={() => {}}
      />,
    );
    expect(screen.getByText("Panes")).toBeTruthy();
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
        metadata={metadata}
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
        metadata={metadata}
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
        metadata={metadata}
        onSelectPane={() => {}}
      />,
    );
    const branchEl = screen.getByText("dev");
    expect(branchEl.classList.contains("pane-list-item__branch--dirty")).toBe(
      true,
    );
  });
});
