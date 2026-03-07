import { useCallback, useState } from "react";

export type ClaudeStatus = "working" | "idle";

export interface ClaudeState {
  status: ClaudeStatus;
}

function parseClaudeStatus(title: string): ClaudeState | null {
  if (!/claude/i.test(title)) return null;
  if (title.includes("\u00B7")) return { status: "working" };
  if (title.includes("\u2733")) return { status: "idle" };
  return { status: "working" };
}

export function useClaudeStatus() {
  const [claudeStatus, setClaudeStatus] = useState<Map<string, ClaudeState>>(
    () => new Map(),
  );

  const handleTitleChange = useCallback((paneId: string, title: string) => {
    const parsed = parseClaudeStatus(title);

    setClaudeStatus((prev) => {
      const existing = prev.get(paneId);
      if (parsed === null) {
        if (!existing) return prev;
        const next = new Map(prev);
        next.delete(paneId);
        return next;
      }
      if (existing?.status === parsed.status) return prev;
      const next = new Map(prev);
      next.set(paneId, parsed);
      return next;
    });
  }, []);

  return { claudeStatus, handleTitleChange };
}
