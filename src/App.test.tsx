import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { setupXtermMocks } from "./test/mocks/xterm";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(1),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  })),
}));

setupXtermMocks();

describe("App", () => {
  it("renders title bar and terminal", () => {
    render(<App />);
    expect(screen.getByTitle("New tab")).toBeInstanceOf(HTMLButtonElement);
    expect(screen.getByTitle("Close")).toBeInstanceOf(HTMLButtonElement);
  });
});
