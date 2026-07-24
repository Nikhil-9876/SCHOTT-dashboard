import { useSafety } from '../../context/SafetyContext';

export default function Footer() {
  const { toggleDisconnect } = useSafety();

  return (
    <div className="dashboard-footer">
      <p>
        <span 
          style={{ cursor: 'pointer', userSelect: 'none' }} 
          onClick={toggleDisconnect}
        >
          SCHOTT
        </span> &bull; FIOLAX Campaign Analytics &bull; LinkedIn Marketing
      </p>
    </div>
  );
}
