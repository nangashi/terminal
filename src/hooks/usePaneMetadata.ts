import { useEffect, useRef, useState } from "react";
import { commands, type GitInfo } from "../bindings";

export type { GitInfo };

export interface PaneMetadata {
  cwd: string | null;
  git: GitInfo | null;
}

const POLL_INTERVAL_MS = 3000;

/**
 * Polls CWD and git info for each pane's PTY.
 * @param paneToPtyEntries - array of [paneId, ptyId] pairs for the active tab
 */
export function usePaneMetadata(
  paneToPtyEntries: [string, number][],
): Map<string, PaneMetadata> {
  const [metadata, setMetadata] = useState<Map<string, PaneMetadata>>(
    () => new Map(),
  );
  const entriesRef = useRef(paneToPtyEntries);

  useEffect(() => {
    entriesRef.current = paneToPtyEntries;
  });

  useEffect(() => {
    let active = true;

    async function poll() {
      const entries = entriesRef.current;
      if (entries.length === 0) return;

      const results = await Promise.allSettled(
        entries.map(async ([paneId, ptyId]) => {
          let cwd: string | null = null;
          let git: GitInfo | null = null;
          const cwdResult = await commands.getPtyCwd(ptyId);
          if (cwdResult.status === "ok") {
            cwd = cwdResult.data;
          }
          if (cwd) {
            git = (await commands.getGitInfo(cwd)) ?? null;
          }
          return { paneId, cwd, git };
        }),
      );

      if (!active) return;

      setMetadata((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          const { paneId, cwd, git } = result.value;
          const existing = prev.get(paneId);
          if (
            existing?.cwd !== cwd ||
            existing?.git?.branch !== git?.branch ||
            existing?.git?.repoName !== git?.repoName ||
            existing?.git?.isDirty !== git?.isDirty
          ) {
            next.set(paneId, { cwd, git });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return metadata;
}
