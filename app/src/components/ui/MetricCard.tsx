import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
}

export default function MetricCard({ label, value }: Props) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}
