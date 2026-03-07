import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { TerminalView } from "./TerminalView";

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    loadAddon = vi.fn();
    open = vi.fn();
    onData = vi.fn();
    onResize = vi.fn();
    dispose = vi.fn();
    write = vi.fn();
    unicode = { activeVersion: "6" };
  },
}));

vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: class MockUnicode11Addon {
    dispose = vi.fn();
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class MockFitAddon {
    fit = vi.fn();
    dispose = vi.fn();
  },
}));

describe("TerminalView", () => {
  it("mounts without crashing", () => {
    const { container } = render(<TerminalView />);
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement);
  });
});
