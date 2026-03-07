import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { setupXtermMocks } from "../test/mocks/xterm";
import { TerminalView } from "./TerminalView";

setupXtermMocks();

describe("TerminalView", () => {
  it("mounts without crashing", () => {
    const { container } = render(<TerminalView />);
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement);
  });
});
