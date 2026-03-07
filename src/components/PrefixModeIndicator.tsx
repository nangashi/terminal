import "./PrefixModeIndicator.css";

interface PrefixModeIndicatorProps {
  visible: boolean;
}

export function PrefixModeIndicator({ visible }: PrefixModeIndicatorProps) {
  if (!visible) return null;
  return <div className="prefix-mode-indicator">PREFIX</div>;
}
