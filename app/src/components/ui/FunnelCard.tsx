import { useNavigate } from 'react-router-dom';

type Variant = 'tofu' | 'mofu' | 'bofu';

interface Props {
  variant: Variant;
  tag: string;
  title: string;
  description: string;
  route: string;
}

export default function FunnelCard({ variant, tag, title, description, route }: Props) {
  const navigate = useNavigate();
  return (
    <div
      className={`funnel-card funnel-card-${variant}`}
      onClick={() => navigate(route)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(route)}
    >
      <div className="funnel-tag">{tag}</div>
      <h4>{title}</h4>
      <p>{description}</p>
      <div className="btn">
        <button
          className="btn btn-secondary btn-full"
          onClick={(e) => { e.stopPropagation(); navigate(route); }}
        >
          Explore
        </button>
      </div>
    </div>
  );
}
