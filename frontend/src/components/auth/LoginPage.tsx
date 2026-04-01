import React, { useState } from 'react'
import { Eye, EyeOff, Lock, User, AlertCircle } from 'lucide-react'

interface LoginPageProps {
  onLogin: (username: string, password: string) => Promise<void>
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password')
      return
    }
    setError('')
    setLoading(true)
    try {
      await onLogin(username, password)
    } catch (err: any) {
      setError(err?.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #0f0f0f 100%)' }}>

      {/* Animated background particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, var(--color-accent), transparent)', filter: 'blur(80px)', animation: 'float 8s ease-in-out infinite' }} />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, var(--color-info), transparent)', filter: 'blur(60px)', animation: 'float 10s ease-in-out infinite reverse' }} />
        <div className="absolute top-1/2 left-1/2 w-64 h-64 rounded-full opacity-3"
          style={{ background: 'radial-gradient(circle, var(--color-success), transparent)', filter: 'blur(70px)', animation: 'float 12s ease-in-out infinite' }} />
      </div>

      {/* Grid pattern overlay */}
      <div className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `linear-gradient(rgba(255,107,53,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,107,53,0.1) 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
        }} />

      {/* Login Card */}
      <div className="relative z-10 w-full max-w-md px-4">
        <div className="rounded-2xl shadow-2xl border"
          style={{
            background: 'rgba(26, 26, 26, 0.85)',
            backdropFilter: 'blur(20px)',
            borderColor: 'rgba(68, 68, 68, 0.4)'
          }}>

          {/* Logo Area */}
          <div className="pt-10 pb-6 flex flex-col items-center">
            <div className="mb-4 relative">
              {/* Glow behind logo */}
              <div className="absolute inset-0 rounded-full opacity-30 blur-xl"
                style={{ background: 'var(--color-accent)' }} />
              <img
                src="/logo/logo.png"
                alt="Trakend OS"
                className="relative w-64 h-auto object-contain drop-shadow-lg"
                onError={(e) => {
                  const target = e.target as HTMLImageElement
                  if (target.src.endsWith('.png')) {
                    target.src = '/logo/logo.svg'
                  } else {
                    target.style.display = 'none'
                    const fallback = target.parentElement?.querySelector('.logo-fallback') as HTMLElement
                    if (fallback) fallback.style.display = 'flex'
                  }
                }}
              />
              <div className="logo-fallback hidden w-24 h-24 rounded-xl items-center justify-center"
                style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-dark))' }}>
                <span className="text-white text-3xl font-bold">T</span>
              </div>
            </div>
            <p className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
              Server Management Platform
            </p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="px-8 pb-8">
            {error && (
              <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg text-sm"
                style={{
                  background: 'rgba(255, 56, 96, 0.1)',
                  border: '1px solid rgba(255, 56, 96, 0.3)',
                  color: 'var(--color-error)'
                }}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {/* Username */}
            <div className="mb-4">
              <label className="block text-xs uppercase tracking-wider mb-2 font-medium"
                style={{ color: 'var(--color-text-secondary)' }}>
                Username
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--color-text-secondary)' }}>
                  <User size={18} />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-lg text-sm transition-all"
                  placeholder="Enter your username"
                  autoFocus
                  autoComplete="username"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>
            </div>

            {/* Password */}
            <div className="mb-6">
              <label className="block text-xs uppercase tracking-wider mb-2 font-medium"
                style={{ color: 'var(--color-text-secondary)' }}>
                Password
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--color-text-secondary)' }}>
                  <Lock size={18} />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 rounded-lg text-sm transition-all"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 hover:opacity-80 transition-opacity"
                  style={{ color: 'var(--color-text-secondary)' }}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Login Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg text-white font-semibold text-sm transition-all duration-300 relative overflow-hidden group"
              style={{
                background: loading
                  ? 'var(--color-surface)'
                  : 'linear-gradient(135deg, var(--color-accent), var(--color-accent-dark))',
                boxShadow: loading ? 'none' : '0 4px 20px rgba(255, 107, 53, 0.3)'
              }}>
              <span className="relative z-10 flex items-center justify-center gap-2">
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animated-spin" />
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <Lock size={16} />
                    <span>Sign In</span>
                  </>
                )}
              </span>
              {!loading && (
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ background: 'linear-gradient(135deg, var(--color-accent-light), var(--color-accent))' }} />
              )}
            </button>

            {/* Footer */}
            <div className="mt-6 text-center">
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Trakend OS &copy; {new Date().getFullYear()} &mdash; Secure Server Management
              </p>
            </div>
          </form>
        </div>
      </div>

      {/* CSS for animations */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-20px) scale(1.05); }
        }
      `}</style>
    </div>
  )
}
