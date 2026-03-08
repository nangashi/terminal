import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TitleBar } from "./TitleBar";
import { Tab } from "../types";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  })),
}));

const makeTabs = (...titles: string[]): Tab[] =>
  titles.map((title, i) => ({ id: `tab-${i}`, title }));

function renderTitleBar(
  overrides: Partial<Parameters<typeof TitleBar>[0]> = {},
) {
  const tabs = overrides.tabs ?? makeTabs("Tab 1", "Tab 2", "Tab 3");
  const props = {
    tabs,
    activeTabId: tabs[0].id,
    onNewTab: vi.fn(),
    onCloseTab: vi.fn(),
    onSelectTab: vi.fn(),
    onReorderTabs: vi.fn(),
    onRenameTab: vi.fn(),
    ...overrides,
  };
  return { ...render(<TitleBar {...props} />), props };
}

afterEach(cleanup);

describe("TitleBar", () => {
  it("renders tabs with correct titles", () => {
    renderTitleBar();
    expect(screen.getByText("Tab 1")).toBeInTheDocument();
    expect(screen.getByText("Tab 2")).toBeInTheDocument();
    expect(screen.getByText("Tab 3")).toBeInTheDocument();
  });

  it("calls onSelectTab when tab is clicked", async () => {
    const user = userEvent.setup();
    const { props } = renderTitleBar();
    await user.click(screen.getByText("Tab 2"));
    expect(props.onSelectTab).toHaveBeenCalledWith("tab-1");
  });

  it("calls onCloseTab when close button is clicked", async () => {
    const user = userEvent.setup();
    const { props } = renderTitleBar();
    const closeBtns = screen.getAllByTitle("Close tab");
    await user.click(closeBtns[1]);
    expect(props.onCloseTab).toHaveBeenCalledWith("tab-1");
    // onSelectTab should NOT be called (stopPropagation)
    expect(props.onSelectTab).not.toHaveBeenCalled();
  });

  it("calls onNewTab when new tab button is clicked", async () => {
    const user = userEvent.setup();
    const { props } = renderTitleBar();
    await user.click(screen.getByTitle("New tab"));
    expect(props.onNewTab).toHaveBeenCalledTimes(1);
  });

  it("enters edit mode on double-click", async () => {
    const user = userEvent.setup();
    renderTitleBar();
    await user.dblClick(screen.getByText("Tab 1"));
    const input = screen.getByDisplayValue("Tab 1");
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe("INPUT");
  });

  it("commits rename on Enter", async () => {
    const user = userEvent.setup();
    const { props } = renderTitleBar();
    await user.dblClick(screen.getByText("Tab 1"));
    const input = screen.getByDisplayValue("Tab 1");
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");
    expect(props.onRenameTab).toHaveBeenCalledWith("tab-0", "Renamed");
  });

  it("cancels rename on Escape", async () => {
    const user = userEvent.setup();
    const { props } = renderTitleBar();
    await user.dblClick(screen.getByText("Tab 1"));
    const input = screen.getByDisplayValue("Tab 1");
    await user.clear(input);
    await user.type(input, "Changed{Escape}");
    expect(props.onRenameTab).not.toHaveBeenCalled();
  });
});
