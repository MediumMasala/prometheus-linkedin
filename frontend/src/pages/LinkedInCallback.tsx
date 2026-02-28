import { useEffect, useState, useRef } from 'react';

export function LinkedInCallback() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasExchanged = useRef(false);

  useEffect(() => {
    // Prevent double execution in React Strict Mode
    if (hasExchanged.current) return;

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const errorParam = urlParams.get('error');
    const errorDescription = urlParams.get('error_description');

    if (errorParam) {
      setStatus('error');
      setError(errorDescription || errorParam);
      return;
    }

    if (code) {
      hasExchanged.current = true;
      exchangeCodeForToken(code);
    } else {
      setStatus('error');
      setError('No authorization code received');
    }
  }, []);

  const exchangeCodeForToken = async (code: string) => {
    try {
      const response = await fetch('/api/linkedin/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to exchange code for token');
      }

      setToken(data.access_token);
      setStatus('success');
      localStorage.setItem('linkedin_access_token', data.access_token);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Connecting to LinkedIn...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-sm border border-red-200 max-w-md text-center">
          <h2 className="text-xl font-bold text-red-600 mb-4">Connection Failed</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <a
            href="/api/linkedin/auth-url"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 mr-2"
            onClick={async (e) => {
              e.preventDefault();
              const res = await fetch('/api/linkedin/auth-url');
              const data = await res.json();
              window.location.href = data.authUrl;
            }}
          >
            Try Again
          </a>
          <a href="/" className="inline-block text-blue-600 hover:underline">
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-green-200 max-w-md text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-green-600 mb-4">Successfully Connected!</h2>
        <p className="text-gray-600 mb-4">LinkedIn account connected.</p>
        <div className="bg-gray-100 p-3 rounded-lg break-all text-xs font-mono mb-4">
          {token?.substring(0, 50)}...
        </div>
        <a href="/" className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Go to Dashboard
        </a>
      </div>
    </div>
  );
}
