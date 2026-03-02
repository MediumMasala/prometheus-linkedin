import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFocusedPassword, setIsFocusedPassword] = useState(false);
  const [isFocusedEmail, setIsFocusedEmail] = useState(false);
  const [eyePosition, setEyePosition] = useState(0);
  const [isHappy, setIsHappy] = useState(false);

  // Calculate eye position based on email length
  useEffect(() => {
    const maxLength = 30;
    const position = Math.min(username.length / maxLength, 1) * 10 - 5;
    setEyePosition(position);
  }, [username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await login(username, password);

    if (!result.success) {
      setError(result.error || 'Login failed');
      setIsHappy(false);
    } else {
      setIsHappy(true);
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 flex items-center justify-center p-4 overflow-hidden">
      {/* Floating Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-20 h-20 bg-orange-200 rounded-full opacity-40 animate-float-slow" />
        <div className="absolute top-40 right-20 w-16 h-16 bg-yellow-200 rounded-full opacity-40 animate-float-medium" />
        <div className="absolute bottom-32 left-20 w-24 h-24 bg-red-200 rounded-full opacity-30 animate-float-fast" />
        <div className="absolute bottom-20 right-10 w-14 h-14 bg-orange-300 rounded-full opacity-30 animate-float-slow" />
        <div className="absolute top-1/2 left-1/4 w-10 h-10 bg-amber-200 rounded-full opacity-40 animate-float-medium" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Character Container */}
        <div className="flex justify-center mb-[-40px] relative z-20">
          <div className="relative">
            {/* Character Body */}
            <div
              className={`w-40 h-40 bg-gradient-to-b from-orange-400 to-orange-500 rounded-full shadow-xl relative transition-transform duration-300 ${isHappy ? 'scale-110' : ''}`}
              style={{
                boxShadow: '0 20px 40px rgba(251, 146, 60, 0.3), inset 0 -10px 20px rgba(0,0,0,0.1)'
              }}
            >
              {/* Ears */}
              <div className="absolute -top-3 left-4 w-10 h-10 bg-gradient-to-b from-orange-400 to-orange-500 rounded-full"
                   style={{ boxShadow: 'inset 0 -5px 10px rgba(0,0,0,0.1)' }}>
                <div className="absolute top-2 left-2 w-6 h-6 bg-orange-300 rounded-full" />
              </div>
              <div className="absolute -top-3 right-4 w-10 h-10 bg-gradient-to-b from-orange-400 to-orange-500 rounded-full"
                   style={{ boxShadow: 'inset 0 -5px 10px rgba(0,0,0,0.1)' }}>
                <div className="absolute top-2 left-2 w-6 h-6 bg-orange-300 rounded-full" />
              </div>

              {/* Face */}
              <div className="absolute inset-4 bg-orange-200 rounded-full flex flex-col items-center justify-center">
                {/* Eyes Container */}
                <div className="flex gap-6 mb-2 relative">
                  {isFocusedPassword ? (
                    // Hands covering eyes
                    <>
                      <div className="relative">
                        <div className="w-10 h-10 bg-orange-400 rounded-full animate-cover-eye-left"
                             style={{ boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }}>
                          <div className="absolute inset-1 flex gap-0.5 justify-center items-center">
                            <div className="w-1.5 h-6 bg-orange-500 rounded-full" />
                            <div className="w-1.5 h-6 bg-orange-500 rounded-full" />
                            <div className="w-1.5 h-6 bg-orange-500 rounded-full" />
                            <div className="w-1.5 h-6 bg-orange-500 rounded-full" />
                          </div>
                        </div>
                      </div>
                      <div className="relative">
                        <div className="w-10 h-10 bg-orange-400 rounded-full animate-cover-eye-right"
                             style={{ boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }}>
                          <div className="absolute inset-1 flex gap-0.5 justify-center items-center">
                            <div className="w-1.5 h-6 bg-orange-500 rounded-full" />
                            <div className="w-1.5 h-6 bg-orange-500 rounded-full" />
                            <div className="w-1.5 h-6 bg-orange-500 rounded-full" />
                            <div className="w-1.5 h-6 bg-orange-500 rounded-full" />
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    // Normal eyes
                    <>
                      <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-inner relative overflow-hidden">
                        <div
                          className="w-5 h-5 bg-gray-800 rounded-full transition-all duration-150 flex items-center justify-center"
                          style={{ transform: `translateX(${eyePosition}px)` }}
                        >
                          <div className="w-2 h-2 bg-white rounded-full absolute top-0.5 left-0.5" />
                        </div>
                        {/* Blink animation */}
                        <div className="absolute inset-0 bg-orange-200 rounded-full animate-blink" />
                      </div>
                      <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-inner relative overflow-hidden">
                        <div
                          className="w-5 h-5 bg-gray-800 rounded-full transition-all duration-150 flex items-center justify-center"
                          style={{ transform: `translateX(${eyePosition}px)` }}
                        >
                          <div className="w-2 h-2 bg-white rounded-full absolute top-0.5 left-0.5" />
                        </div>
                        {/* Blink animation */}
                        <div className="absolute inset-0 bg-orange-200 rounded-full animate-blink" />
                      </div>
                    </>
                  )}
                </div>

                {/* Nose */}
                <div className="w-4 h-3 bg-orange-600 rounded-full mb-1" />

                {/* Mouth */}
                <div className={`transition-all duration-300 ${
                  error ? 'w-8 h-4 border-b-4 border-orange-600 rounded-b-full' :
                  isHappy ? 'w-10 h-5 bg-orange-600 rounded-full' :
                  isFocusedEmail ? 'w-6 h-2 bg-orange-600 rounded-full' :
                  'w-4 h-1 bg-orange-600 rounded-full'
                }`}>
                  {isHappy && (
                    <div className="w-6 h-2 bg-red-400 rounded-full mx-auto mt-1" />
                  )}
                </div>
              </div>

              {/* Blush */}
              <div className="absolute bottom-12 left-3 w-6 h-3 bg-pink-300 rounded-full opacity-50" />
              <div className="absolute bottom-12 right-3 w-6 h-3 bg-pink-300 rounded-full opacity-50" />
            </div>

            {/* Arms (visible when not covering eyes) */}
            {!isFocusedPassword && (
              <>
                <div className="absolute -left-6 top-20 w-8 h-16 bg-gradient-to-b from-orange-400 to-orange-500 rounded-full transform -rotate-12 animate-wave-left"
                     style={{ boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }} />
                <div className="absolute -right-6 top-20 w-8 h-16 bg-gradient-to-b from-orange-400 to-orange-500 rounded-full transform rotate-12 animate-wave-right"
                     style={{ boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }} />
              </>
            )}
          </div>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-3xl p-8 shadow-2xl border border-orange-100 relative"
             style={{ boxShadow: '0 25px 50px -12px rgba(251, 146, 60, 0.25)' }}>
          {/* Header */}
          <div className="text-center mb-6 pt-8">
            <h1 className="text-2xl font-bold text-gray-800 mb-1">Welcome to Prometheus v2!</h1>
            <p className="text-gray-500 text-sm">Sign in to Prometheus</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm text-center animate-shake">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">
                Email
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setIsFocusedEmail(true)}
                onBlur={() => setIsFocusedEmail(false)}
                className="w-full px-4 py-3.5 bg-orange-50 border-2 border-orange-100 rounded-xl text-gray-800 placeholder-gray-400 focus:outline-none focus:border-orange-400 focus:bg-white transition-all duration-200"
                placeholder="Enter your email"
                required
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setIsFocusedPassword(true)}
                onBlur={() => setIsFocusedPassword(false)}
                className="w-full px-4 py-3.5 bg-orange-50 border-2 border-orange-100 rounded-xl text-gray-800 placeholder-gray-400 focus:outline-none focus:border-orange-400 focus:bg-white transition-all duration-200"
                placeholder="Enter your password"
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-orange-700 focus:outline-none focus:ring-4 focus:ring-orange-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-orange-200 transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="text-center text-gray-400 text-xs mt-6">
            Prometheus Analytics Dashboard
          </p>
        </div>
      </div>

      {/* Custom CSS for animations */}
      <style>{`
        @keyframes float-slow {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-20px) rotate(5deg); }
        }
        @keyframes float-medium {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-15px) rotate(-5deg); }
        }
        @keyframes float-fast {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-25px) rotate(3deg); }
        }
        @keyframes blink {
          0%, 90%, 100% { transform: scaleY(0); }
          95% { transform: scaleY(1); }
        }
        @keyframes cover-eye-left {
          0% { transform: translateX(-20px) translateY(-20px); opacity: 0; }
          100% { transform: translateX(0) translateY(0); opacity: 1; }
        }
        @keyframes cover-eye-right {
          0% { transform: translateX(20px) translateY(-20px); opacity: 0; }
          100% { transform: translateX(0) translateY(0); opacity: 1; }
        }
        @keyframes wave-left {
          0%, 100% { transform: rotate(-12deg); }
          50% { transform: rotate(-20deg); }
        }
        @keyframes wave-right {
          0%, 100% { transform: rotate(12deg); }
          50% { transform: rotate(20deg); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
          20%, 40%, 60%, 80% { transform: translateX(5px); }
        }
        .animate-float-slow { animation: float-slow 6s ease-in-out infinite; }
        .animate-float-medium { animation: float-medium 4s ease-in-out infinite; }
        .animate-float-fast { animation: float-fast 5s ease-in-out infinite; }
        .animate-blink { animation: blink 4s ease-in-out infinite; }
        .animate-cover-eye-left { animation: cover-eye-left 0.3s ease-out forwards; }
        .animate-cover-eye-right { animation: cover-eye-right 0.3s ease-out forwards; }
        .animate-wave-left { animation: wave-left 2s ease-in-out infinite; }
        .animate-wave-right { animation: wave-right 2s ease-in-out infinite 0.5s; }
        .animate-shake { animation: shake 0.5s ease-in-out; }
      `}</style>
    </div>
  );
}
