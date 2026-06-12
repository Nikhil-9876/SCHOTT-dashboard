interface SkeletonProps {
  height?: number | string;
  width?: number | string;
  style?: React.CSSProperties;
}

export function Skeleton({ height = 40, width = '100%', style }: SkeletonProps) {
  return (
    <div
      className="skeleton"
      style={{ height, width, ...style }}
      aria-hidden="true"
    />
  );
}

/** A card-shaped skeleton */
export function SkeletonCard({ height = 100 }: { height?: number }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E0E4EA', padding: '1.5rem 1.75rem' }}>
      <Skeleton height={12} width="40%" style={{ marginBottom: 12 }} />
      <Skeleton height={height} width="60%" style={{ marginBottom: 10 }} />
      <Skeleton height={10} width="80%" />
    </div>
  );
}

/** A chart-shaped skeleton */
export function SkeletonChart({ height = 280 }: { height?: number }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #E0E4EA',
        padding: '1.5rem',
        marginBottom: '1.25rem',
      }}
    >
      <Skeleton height={14} width="30%" style={{ marginBottom: 16 }} />
      <Skeleton height={height} />
    </div>
  );
}
