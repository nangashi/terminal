import { useCallback } from "react";
import { PaneMetadata } from "../hooks/usePaneMetadata";
import { ClaudeState } from "../hooks/useClaudeStatus";
import "./Sidebar.css";

export interface PaneInfo {
  id: string;
  index: number;
  isActive: boolean;
}

interface SidebarProps {
  panes: PaneInfo[];
  metadata: Map<string, PaneMetadata>;
  claudeStatus: Map<string, ClaudeState>;
  onSelectPane: (paneId: string) => void;
}

export function Sidebar({
  panes,
  metadata,
  claudeStatus,
  onSelectPane,
}: SidebarProps) {
  return (
    <div className="sidebar">
      {panes.map((pane) => (
        <PaneListItem
          key={pane.id}
          pane={pane}
          metadata={metadata.get(pane.id)}
          claude={claudeStatus.get(pane.id)}
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

function cwdShortPath(cwd: string): string {
  const homeMatch = cwd.match(/^\/home\/[^/]+/);
  if (homeMatch) {
    return "~" + cwd.slice(homeMatch[0].length);
  }
  if (cwd.startsWith("/root")) {
    return "~" + cwd.slice("/root".length);
  }
  return cwd;
}

interface PaneListItemProps {
  pane: PaneInfo;
  metadata: PaneMetadata | undefined;
  claude: ClaudeState | undefined;
  onSelectPane: (paneId: string) => void;
}

function PaneListItem({
  pane,
  metadata,
  claude,
  onSelectPane,
}: PaneListItemProps) {
  const handleClick = useCallback(() => {
    onSelectPane(pane.id);
  }, [pane.id, onSelectPane]);

  const git = metadata?.git;
  const label = git?.repoName
    ? git.repoName
    : metadata?.cwd
      ? cwdDisplayName(metadata.cwd)
      : `Pane ${pane.index}`;

  const cwd = metadata?.cwd;

  return (
    <div
      className={`pane-list-item${pane.isActive ? " pane-list-item--active" : ""}`}
      onClick={handleClick}
    >
      <span className="pane-list-item__index">{pane.index}</span>
      <div className="pane-list-item__content">
        <div className="pane-list-item__label-row">
          <span className="pane-list-item__label">{label}</span>
          {claude && (
            <span
              className={`pane-list-item__claude pane-list-item__claude-${claude.status === "working" ? "working" : "idle"}`}
            >
              {"\uD83E\uDD16"}
              <span className="pane-list-item__claude-status">
                {claude.status === "working" ? (
                  <>
                    <span
                      className="pane-list-item__claude-dot"
                      style={{ animationDelay: "0s" }}
                    >
                      {"\u25CF"}
                    </span>
                    <span
                      className="pane-list-item__claude-dot"
                      style={{ animationDelay: "0.2s" }}
                    >
                      {"\u25CF"}
                    </span>
                    <span
                      className="pane-list-item__claude-dot"
                      style={{ animationDelay: "0.4s" }}
                    >
                      {"\u25CF"}
                    </span>
                  </>
                ) : (
                  <span>{"\u5F85\u6A5F"}</span>
                )}
              </span>
            </span>
          )}
        </div>
        {git && (
          <span
            className={`pane-list-item__branch${git.isDirty ? " pane-list-item__branch--dirty" : ""}`}
          >
            {git.branch}
            {git.isDirty && <span className="pane-list-item__dirty"> ●</span>}
          </span>
        )}
        {cwd && (
          <span className="pane-list-item__cwd">{cwdShortPath(cwd)}</span>
        )}
      </div>
    </div>
  );
}
