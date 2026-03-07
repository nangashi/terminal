import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(1),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

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

describe("App", () => {
  it("renders terminal view", () => {
    const { container } = render(<App />);
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement);
  });
});
