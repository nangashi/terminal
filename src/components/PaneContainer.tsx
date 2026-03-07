import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import { PaneNode } from "../types";
import {
  computeLeafRects,
  computeDividerRects,
  LeafRect,
  DividerRect,
} from "../lib/paneTree";
import { TerminalView, TerminalHandle } from "./TerminalView";
import { PaneDivider } from "./PaneDivider";
import "./PaneContainer.css";

interface PaneContainerProps {
  node: PaneNode;
  activePaneId: string;
  onData: (paneId: string, data: string) => void;
  onResize: (paneId: string, cols: number, rows: number) => void;
  onPaneRef: (paneId: string, handle: TerminalHandle | null) => void;
  onPaneFocus: (paneId: string) => void;
  onDividerDrag: (splitNodeId: string, delta: number) => void;
}

export function PaneContainer({
  node,
  activePaneId,
  onData,
  onResize,
  onPaneRef,
  onPaneFocus,
  onDividerDrag,
}: PaneContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width || 1,
          height: entry.contentRect.height || 1,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const leafRects: LeafRect[] = useMemo(
    () => computeLeafRects(node, undefined, containerSize),
    [node, containerSize],
  );
  const dividerRects: DividerRect[] = useMemo(
    () => computeDividerRects(node),
    [node],
  );

  return (
    <div ref={containerRef} className="pane-container">
      {leafRects.map((lr) => (
        <LeafPane
          key={lr.paneId}
          paneId={lr.paneId}
          rect={lr.rect}
          containerSize={containerSize}
          isActive={lr.paneId === activePaneId}
          onData={onData}
          onResize={onResize}
          onPaneRef={onPaneRef}
          onPaneFocus={onPaneFocus}
        />
      ))}
      {dividerRects.map((dr) => (
        <PaneDivider
          key={dr.splitId}
          splitId={dr.splitId}
          direction={dr.direction}
          rect={dr.rect}
          containerSize={containerSize}
          onDividerDrag={onDividerDrag}
        />
      ))}
    </div>
  );
}

interface LeafPaneProps {
  paneId: string;
  rect: { x: number; y: number; w: number; h: number };
  containerSize: { width: number; height: number };
  isActive: boolean;
  onData: (paneId: string, data: string) => void;
  onResize: (paneId: string, cols: number, rows: number) => void;
  onPaneRef: (paneId: string, handle: TerminalHandle | null) => void;
  onPaneFocus: (paneId: string) => void;
}

function LeafPane({
  paneId,
  rect,
  containerSize,
  isActive,
  onData,
  onResize,
  onPaneRef,
  onPaneFocus,
}: LeafPaneProps) {
  const handleData = useCallback(
    (data: string) => onData(paneId, data),
    [paneId, onData],
  );
  const handleResize = useCallback(
    (cols: number, rows: number) => onResize(paneId, cols, rows),
    [paneId, onResize],
  );
  const handleRef = useCallback(
    (handle: TerminalHandle | null) => onPaneRef(paneId, handle),
    [paneId, onPaneRef],
  );
  const handleClick = useCallback(
    () => onPaneFocus(paneId),
    [paneId, onPaneFocus],
  );

  const style: React.CSSProperties = {
    position: "absolute",
    left: rect.x * containerSize.width,
    top: rect.y * containerSize.height,
    width: rect.w * containerSize.width,
    height: rect.h * containerSize.height,
  };

  return (
    <div
      className={`pane-leaf ${isActive ? "pane-leaf--active" : ""}`}
      style={style}
      onMouseDown={handleClick}
    >
      <TerminalView
        ref={handleRef}
        isActive={isActive}
        onData={handleData}
        onResize={handleResize}
      />
    </div>
  );
}
