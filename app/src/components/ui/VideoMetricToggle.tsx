interface Props {
  mode: 'video' | 'general';
  onChange: (mode: 'video' | 'general') => void;
}

/** The "VIEW METRICS: General | Video Specific" filter-pill toggle used
 *  in Video Views sections on TOFU and BOFU pages. */
export default function VideoMetricToggle({ mode, onChange }: Props) {
  return (
    <div className="filter-group" style={{ margin: 0 }}>
      <span className="filter-label" style={{ fontSize: 11, fontWeight: 700 }}>VIEW METRICS:</span>
      <div className="filter-pills">
        <button
          className={`filter-pill ${mode === 'general' ? 'active' : ''}`}
          onClick={() => onChange('general')}
          style={{ fontSize: 11, padding: '0.2rem 0.65rem' }}
        >
          General
        </button>
        <button
          className={`filter-pill ${mode === 'video' ? 'active' : ''}`}
          onClick={() => onChange('video')}
          style={{ fontSize: 11, padding: '0.2rem 0.65rem' }}
        >
          Video Specific
        </button>
      </div>
    </div>
  );
}
