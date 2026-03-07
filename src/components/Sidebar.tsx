import { useCallback } from "react";
import { PaneMetadata } from "../hooks/usePaneMetadata";
import "./Sidebar.css";

export interface PaneInfo {
  id: string;
  index: number;
  isActive: boolean;
}

interface SidebarProps {
  panes: PaneInfo[];
  metadata: Map<string, PaneMetadata>;
  onSelectPane: (paneId: string) => void;
}

export function Sidebar({ panes, metadata, onSelectPane }: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">Panes</div>
      {panes.map((pane) => (
        <PaneListItem
          key={pane.id}
          pane={pane}
          metadata={metadata.get(pane.id)}
          onSelectPane={onSelectPane}
        />
      ))}
    </div>
  );
}

function cwdDisplayName(cwd: string): string {
  const parts = cwd.split("/");
  return parts[parts.length - 1] || cwd;
}

interface PaneListItemProps {
  pane: PaneInfo;
  metadata: PaneMetadata | undefined;
  onSelectPane: (paneId: string) => void;
}

function PaneListItem({ pane, metadata, onSelectPane }: PaneListItemProps) {
  const handleClick = useCallback(() => {
    onSelectPane(pane.id);
  }, [pane.id, onSelectPane]);

  const git = metadata?.git;
  const label = git?.repoName
    ? git.repoName
    : metadata?.cwd
      ? cwdDisplayName(metadata.cwd)
      : `Pane ${pane.index}`;

  return (
    <div
      className={`pane-list-item${pane.isActive ? " pane-list-item--active" : ""}`}
      onClick={handleClick}
    >
      <span className="pane-list-item__index">{pane.index}</span>
      <div className="pane-list-item__content">
        <span className="pane-list-item__label">{label}</span>
        {git && (
          <span
            className={`pane-list-item__branch${git.isDirty ? " pane-list-item__branch--dirty" : ""}`}
          >
            {git.branch}
          </span>
        )}
      </div>
    </div>
  );
}
