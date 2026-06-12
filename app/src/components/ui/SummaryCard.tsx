import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  detail?: string;
}

export default function SummaryCard({ label, value, detail }: Props) {
  return (
    <div className="summary-card">
      <h3>{label}</h3>
      <div className="summary-value">{value}</div>
      {detail && <div className="summary-detail">{detail}</div>}
    </div>
  );
}
