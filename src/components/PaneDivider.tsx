import { useCallback, useRef } from "react";
import { SplitDirection } from "../types";
import "./PaneDivider.css";

interface PaneDividerProps {
  splitId: string;
  direction: SplitDirection;
  rect: { x: number; y: number; w: number; h: number };
  containerSize: { width: number; height: number };
  onDrag: (delta: number) => void;
}

const DIVIDER_SIZE = 4; // px - must match CSS and paneTree.ts

export function PaneDivider({
  direction,
  rect,
  containerSize,
  onDrag,
}: PaneDividerProps) {
  const dragging = useRef(false);
  const startPos = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const isVertical = direction === "vertical";
      startPos.current = isVertical ? e.clientX : e.clientY;
      const totalSize = isVertical ? containerSize.width : containerSize.height;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const current = isVertical ? ev.clientX : ev.clientY;
        const delta = (current - startPos.current) / totalSize;
        startPos.current = current;
        onDrag(delta);
      };

      const handleMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = isVertical ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [direction, containerSize, onDrag],
  );

  const isVertical = direction === "vertical";
  const style: React.CSSProperties = {
    position: "absolute",
    left: isVertical
      ? rect.x * containerSize.width - DIVIDER_SIZE / 2
      : rect.x * containerSize.width,
    top: isVertical
      ? rect.y * containerSize.height
      : rect.y * containerSize.height - DIVIDER_SIZE / 2,
    width: isVertical ? DIVIDER_SIZE : rect.w * containerSize.width,
    height: isVertical ? rect.h * containerSize.height : DIVIDER_SIZE,
  };

  return (
    <div
      className={`pane-divider pane-divider--${direction}`}
      style={style}
      onMouseDown={handleMouseDown}
    />
  );
}
