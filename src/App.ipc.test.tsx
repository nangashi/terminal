import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC, mockWindows, clearMocks } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import {
  setupXtermMocks,
  xtermWriteCalls,
  clearXtermWriteCalls,
} from "./test/mocks/xterm";
import { PTY_OUTPUT_EVENT, PTY_EXIT_EVENT } from "./constants";
import App from "./App";

setupXtermMocks();

interface IpcCall {
  cmd: string;
  payload: Record<string, unknown> | undefined;
}

let ipcCalls: IpcCall[];

beforeEach(() => {
  ipcCalls = [];
  let nextPtyId = 1;

  mockWindows("main");
  mockIPC(
    (cmd, payload) => {
      ipcCalls.push({
        cmd: cmd as string,
        payload: payload as Record<string, unknown> | undefined,
      });
      switch (cmd) {
        case "create_pty":
          return nextPtyId++;
        case "write_pty":
        case "resize_pty":
        case "close_pty":
          return null;
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
});

afterEach(() => {
  cleanup();
  clearMocks();
  clearXtermWriteCalls();
});

describe("App IPC integration", () => {
  it("calls create_pty on mount", async () => {
    render(<App />);
    await waitFor(() => {
      expect(ipcCalls.filter((c) => c.cmd === "create_pty")).toHaveLength(1);
    });
  });

  it("calls create_pty for new tab", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => {
      expect(ipcCalls.filter((c) => c.cmd === "create_pty")).toHaveLength(1);
    });

    await user.click(screen.getByTitle("New tab"));

    await waitFor(() => {
      expect(ipcCalls.filter((c) => c.cmd === "create_pty")).toHaveLength(2);
    });
  });

  it("calls close_pty with correct id on tab close", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => {
      expect(ipcCalls.filter((c) => c.cmd === "create_pty")).toHaveLength(1);
    });

    await user.click(screen.getByTitle("New tab"));
    await waitFor(() => {
      expect(ipcCalls.filter((c) => c.cmd === "create_pty")).toHaveLength(2);
    });

    // Close the first tab
    const closeBtns = screen.getAllByTitle("Close tab");
    await user.click(closeBtns[0]);

    const closeCall = ipcCalls.find((c) => c.cmd === "close_pty");
    expect(closeCall).toBeDefined();
    expect(closeCall!.payload?.id).toBe(1);
  });

  it("writes to terminal on pty-output event", async () => {
    render(<App />);
    await waitFor(() => {
      expect(ipcCalls.filter((c) => c.cmd === "create_pty")).toHaveLength(1);
    });

    // Wait for ptyToTab mapping to be set (state update after create_pty resolves)
    await waitFor(() => {
      // The tabStates update triggers a re-render; wait for it
      expect(screen.getAllByTitle("Close tab")).toHaveLength(1);
    });

    // Emit pty-output event: "HI" = [72, 73]
    await emit(PTY_OUTPUT_EVENT, { id: 1, data: [72, 73] });

    await waitFor(() => {
      expect(xtermWriteCalls.length).toBeGreaterThan(0);
    });
  });

  it("removes tab on pty-exit event", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => {
      expect(ipcCalls.filter((c) => c.cmd === "create_pty")).toHaveLength(1);
    });

    await user.click(screen.getByTitle("New tab"));
    await waitFor(() => {
      expect(ipcCalls.filter((c) => c.cmd === "create_pty")).toHaveLength(2);
    });

    expect(screen.getAllByTitle("Close tab")).toHaveLength(2);

    // Emit pty-exit for first PTY
    await emit(PTY_EXIT_EVENT, { id: 1 });

    await waitFor(() => {
      expect(screen.getAllByTitle("Close tab")).toHaveLength(1);
    });
  });

  it("maps PTY IDs correctly across multiple tabs", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => {
      expect(ipcCalls.filter((c) => c.cmd === "create_pty")).toHaveLength(1);
    });

    await user.click(screen.getByTitle("New tab"));
    await waitFor(() => {
      expect(ipcCalls.filter((c) => c.cmd === "create_pty")).toHaveLength(2);
    });

    await user.click(screen.getByTitle("New tab"));
    await waitFor(() => {
      expect(ipcCalls.filter((c) => c.cmd === "create_pty")).toHaveLength(3);
    });

    // Close the middle tab (index 1, PTY ID 2)
    const closeBtns = screen.getAllByTitle("Close tab");
    await user.click(closeBtns[1]);

    const closeCall = ipcCalls.find((c) => c.cmd === "close_pty");
    expect(closeCall).toBeDefined();
    expect(closeCall!.payload?.id).toBe(2);
  });
});
