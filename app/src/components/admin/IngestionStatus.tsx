import { useIngestionLog, useTriggerIngestion, useLinkedInConnection, useDisconnectLinkedIn } from '../../lib/queries';

export default function IngestionStatus() {
  const { data: logs } = useIngestionLog();
  const { mutate: sync, isPending } = useTriggerIngestion();
  const { data: isConnected, isLoading: isConnectionLoading } = useLinkedInConnection();
  const { mutate: disconnect } = useDisconnectLinkedIn();

  const lastLog = logs?.[0];
  const isFailed = lastLog?.status === 'failed';

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }

  const handleConnectLinkedIn = () => {
    // You must replace this with your actual LinkedIn Client ID
    const clientId = import.meta.env.VITE_LINKEDIN_CLIENT_ID || 'REPLACE_ME';
    const redirectUri = encodeURIComponent(window.location.origin + '/auth/callback');
    // Requesting r_ads and r_ads_reporting for real campaign and analytics access
    const scope = encodeURIComponent('openid profile email r_ads r_ads_reporting');
    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}`;
    window.location.href = authUrl;
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      {isConnected ? (
        <>
          <span className={`header-sync-info${isFailed ? ' failed' : ''}`}>
            {lastLog
              ? isFailed
                ? `Last sync — Failed`
                : `Last synced: ${formatDate(lastLog.finished_at ?? lastLog.started_at)}`
              : 'Never synced'}
          </span>
          <button
            className="btn btn-primary"
            style={{ padding: '0.45rem 1rem', fontSize: '12px' }}
            onClick={() => sync()}
            disabled={isPending}
          >
            {isPending ? 'Syncing…' : 'Sync Now'}
          </button>
          <button
            className="btn"
            style={{ 
              padding: '0.45rem 1rem', 
              fontSize: '12px', 
              backgroundColor: '#ef4444', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: 'pointer' 
            }}
            onClick={() => disconnect()}
          >
            Disconnect
          </button>
        </>
      ) : (
        <button
          className="btn btn-primary"
          style={{ padding: '0.45rem 1rem', fontSize: '12px', backgroundColor: '#0077b5', borderColor: '#0077b5' }}
          onClick={handleConnectLinkedIn}
          disabled={isConnectionLoading}
        >
          {isConnectionLoading ? 'Loading…' : 'Connect LinkedIn'}
        </button>
      )}
    </div>
  );
}
