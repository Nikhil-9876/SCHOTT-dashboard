type BadgeVariant = 'active' | 'completed' | 'paused';

interface Props {
  status: string;
}

function getVariant(status: string): BadgeVariant {
  const s = status.toUpperCase();
  if (s === 'ACTIVE') return 'active';
  if (s === 'COMPLETED') return 'completed';
  return 'paused';
}

export default function Badge({ status }: Props) {
  const variant = getVariant(status);
  return (
    <span className={`badge badge-${variant}`}>
      {status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}
    </span>
  );
}
