import { useCallback } from "react";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";

export function useClipboard() {
  const write = useCallback((text: string) => writeText(text), []);
  const read = useCallback(() => readText(), []);
  return { write, read };
}
