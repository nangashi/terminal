import { vi } from "vitest";

export function setupXtermMocks() {
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
}
