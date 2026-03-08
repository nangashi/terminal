import { useMemo, useRef, useState, useCallback, useEffect } from "react";
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
  onRenameTab: (id: string, title: string) => void;
}

export function TitleBar({
  tabs,
  activeTabId,
  onNewTab,
  onCloseTab,
  onSelectTab,
  onReorderTabs,
  onRenameTab,
}: TitleBarProps) {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragSourceId = useRef<string | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const editFinishedRef = useRef(false);

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

  const handleDoubleClick = useCallback((tab: Tab) => {
    editFinishedRef.current = false;
    setEditingTabId(tab.id);
    setEditValue(tab.title);
  }, []);

  const finishEdit = useCallback(
    (commit: boolean) => {
      if (editFinishedRef.current) return;
      editFinishedRef.current = true;
      if (commit && editingTabId !== null) {
        const trimmed = editValue.trim();
        if (trimmed) {
          onRenameTab(editingTabId, trimmed);
        }
      }
      setEditingTabId(null);
    },
    [editingTabId, editValue, onRenameTab],
  );

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finishEdit(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finishEdit(false);
      }
    },
    [finishEdit],
  );

  useEffect(() => {
    if (editingTabId !== null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingTabId]);

  return (
    <div className="titlebar">
      <div
        className="titlebar-tabs"
        data-tauri-drag-region
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) {
            appWindow.toggleMaximize();
          }
        }}
      >
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
            {editingTabId === tab.id ? (
              <input
                ref={editInputRef}
                className="tab-label-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                onBlur={() => finishEdit(true)}
              />
            ) : (
              <span
                className="tab-label"
                onDoubleClick={() => handleDoubleClick(tab)}
              >
                {tab.title}
              </span>
            )}
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
