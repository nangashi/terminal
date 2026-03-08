import React from "react";
import { afterEach, describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
  setupXtermMocks,
  xtermWriteCalls,
  clearXtermWriteCalls,
} from "../test/mocks/xterm";
import { TerminalView, TerminalHandle } from "./TerminalView";

setupXtermMocks();

afterEach(() => {
  cleanup();
  clearXtermWriteCalls();
});

describe("TerminalView", () => {
  it("mounts without crashing", () => {
    const { container } = render(<TerminalView />);
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement);
  });

  it("exposes write method via imperative handle", () => {
    const ref = React.createRef<TerminalHandle>();
    render(<TerminalView ref={ref} />);
    expect(ref.current).not.toBeNull();
    ref.current!.write("hello");
    expect(xtermWriteCalls).toContain("hello");
  });

  it("disposes terminal on unmount", () => {
    const ref = React.createRef<TerminalHandle>();
    const { unmount } = render(<TerminalView ref={ref} />);
    // Get the terminal instance before unmount
    const terminal = ref.current?.terminal;
    expect(terminal).not.toBeNull();
    unmount();
    expect(terminal!.dispose).toHaveBeenCalled();
  });
});
