import { useMemo, useRef, useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tab } from "../types";
import "./TitleBar.css";

interface TitleBarProps {
  tabs: Tab[];
  activeTabId: string;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onSelectTab: (id: string) => void;
  onReorderTabs: (tabs: Tab[]) => void;
}

export function TitleBar({
  tabs,
  activeTabId,
  onNewTab,
  onCloseTab,
  onSelectTab,
  onReorderTabs,
}: TitleBarProps) {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragSourceId = useRef<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    dragSourceId.current = id;
    e.dataTransfer.effectAllowed = "move";
    // Transparent drag image — we use CSS indicator instead
    const img = new Image();
    img.src =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    e.dataTransfer.setDragImage(img, 0, 0);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragSourceId.current && dragSourceId.current !== id) {
      setDragOverId(id);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      const sourceId = dragSourceId.current;
      if (!sourceId || sourceId === targetId) return;

      const reordered = [...tabs];
      const srcIdx = reordered.findIndex((t) => t.id === sourceId);
      const tgtIdx = reordered.findIndex((t) => t.id === targetId);
      if (srcIdx === -1 || tgtIdx === -1) return;

      const [moved] = reordered.splice(srcIdx, 1);
      reordered.splice(tgtIdx, 0, moved);
      onReorderTabs(reordered);
      setDragOverId(null);
      dragSourceId.current = null;
    },
    [tabs, onReorderTabs],
  );

  const handleDragEnd = useCallback(() => {
    setDragOverId(null);
    dragSourceId.current = null;
  }, []);

  return (
    <div className="titlebar">
      <div className="titlebar-tabs" data-tauri-drag-region>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`titlebar-tab${tab.id === activeTabId ? " active" : ""}${tab.id === dragOverId ? " drag-over" : ""}`}
            onClick={() => onSelectTab(tab.id)}
            draggable
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragOver={(e) => handleDragOver(e, tab.id)}
            onDrop={(e) => handleDrop(e, tab.id)}
            onDragEnd={handleDragEnd}
          >
            <span className="tab-label">{tab.title}</span>
            <button
              className="tab-close"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8">
                <path
                  d="M1 1l6 6M7 1l-6 6"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ))}
        <button className="titlebar-new-tab" title="New tab" onClick={onNewTab}>
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path
              fill="currentColor"
              d="M6 1v10M1 6h10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn"
          title="Minimize"
          onClick={() => appWindow.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path
              fill="currentColor"
              d="M1 5h8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          className="titlebar-btn"
          title="Maximize"
          onClick={() => appWindow.toggleMaximize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect
              x="1"
              y="1"
              width="8"
              height="8"
              rx="1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          title="Close"
          onClick={() => appWindow.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path
              d="M1 1l8 8M9 1l-8 8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
