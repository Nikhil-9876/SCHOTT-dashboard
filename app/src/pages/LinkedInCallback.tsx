import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useQueryClient } from '@tanstack/react-query';

export default function LinkedInCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      setStatus('error');
      setErrorMsg(errorDescription || error);
      return;
    }

    if (!code) {
      setStatus('error');
      setErrorMsg('No authorization code found in URL.');
      return;
    }

    const exchangeCode = async () => {
      try {
        const { error: invokeError } = await supabase.functions.invoke('linkedin-auth-callback', {
          body: { 
            code,
            redirectUri: window.location.origin + '/auth/callback'
          }
        });

        if (invokeError) throw new Error(invokeError.message);

        setStatus('success');
        // Invalidate to refresh connection status
        queryClient.invalidateQueries({ queryKey: ['linkedin_connection'] });
        
        // Redirect back to dashboard after a short delay
        setTimeout(() => {
          navigate('/');
        }, 2000);
      } catch (err: any) {
        console.error('Failed to exchange code:', err);
        setStatus('error');
        setErrorMsg(err.message || 'An error occurred while linking your account.');
      }
    };

    exchangeCode();
  }, [location, navigate, queryClient]);

  return (
    <div style={{ padding: '2rem', textAlign: 'center', marginTop: '100px' }}>
      <h2>LinkedIn Authentication</h2>
      {status === 'loading' && <p>Linking your account... please wait.</p>}
      {status === 'success' && (
        <div style={{ color: 'var(--success-color)' }}>
          <p>Account successfully linked! Redirecting back to dashboard...</p>
        </div>
      )}
      {status === 'error' && (
        <div style={{ color: 'var(--danger-color)' }}>
          <p>Failed to link account:</p>
          <p>{errorMsg}</p>
          <button className="btn btn-primary" onClick={() => navigate('/')} style={{ marginTop: '1rem' }}>
            Return to Dashboard
          </button>
        </div>
      )}
    </div>
  );
}
