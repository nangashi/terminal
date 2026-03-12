import { useCallback, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useWindowControl() {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const minimize = useCallback(() => appWindow.minimize(), [appWindow]);
  const toggleMaximize = useCallback(
    () => appWindow.toggleMaximize(),
    [appWindow],
  );
  const close = useCallback(() => appWindow.close(), [appWindow]);
  return { minimize, toggleMaximize, close };
}
