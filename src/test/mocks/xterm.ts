import { vi } from "vitest";

export const xtermWriteCalls: unknown[] = [];

export function clearXtermWriteCalls() {
  xtermWriteCalls.length = 0;
}

export function setupXtermMocks() {
  vi.mock("@xterm/xterm", () => ({
    Terminal: class MockTerminal {
      loadAddon = vi.fn();
      open = vi.fn();
      onData = vi.fn();
      onResize = vi.fn();
      dispose = vi.fn();
      write = vi.fn((data: unknown) => {
        xtermWriteCalls.push(data);
      });
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
