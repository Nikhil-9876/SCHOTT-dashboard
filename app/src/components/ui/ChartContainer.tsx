import type { ReactNode } from 'react';

interface Props {
  title?: string;
  children: ReactNode;
  style?: React.CSSProperties;
}

export default function ChartContainer({ title, children, style }: Props) {
  return (
    <div className="chart-container" style={style}>
      {title && <div className="chart-title">{title}</div>}
      {children}
    </div>
  );
}
