import React, { useEffect, useState } from 'react'

interface BootScreenProps {
  onBootComplete: () => void
}

interface BootStep {
  label: string
  duration: number
}

const bootSequence: BootStep[] = [
  { label: 'Initializing Trakend OS kernel...', duration: 400 },
  { label: 'Loading system modules...', duration: 300 },
  { label: 'Detecting hardware configuration...', duration: 500 },
  { label: 'Mounting file systems...', duration: 350 },
  { label: 'Initializing network interfaces...', duration: 300 },
  { label: 'Starting Docker daemon...', duration: 400 },
  { label: 'Loading SSH service...', duration: 250 },
  { label: 'Initializing database engine...', duration: 300 },
  { label: 'Starting event logging service...', duration: 250 },
  { label: 'Waking up Maya AI assistant...', duration: 600 },
  { label: 'Running system health check...', duration: 400 },
  { label: 'Applying user configuration...', duration: 250 },
  { label: 'Starting web interface...', duration: 350 },
  { label: 'System ready.', duration: 500 },
]

export const BootScreen: React.FC<BootScreenProps> = ({ onBootComplete }) => {
  const [currentStep, setCurrentStep] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<string[]>([])
  const [fadeOut, setFadeOut] = useState(false)
  const [logoLoaded, setLogoLoaded] = useState(false)

  useEffect(() => {
    // Small delay before starting boot sequence
    const startDelay = setTimeout(() => {
      setLogoLoaded(true)
    }, 300)

    return () => clearTimeout(startDelay)
  }, [])

  useEffect(() => {
    if (!logoLoaded) return

    if (currentStep >= bootSequence.length) {
      // Boot complete, fade out
      const fadeTimer = setTimeout(() => {
        setFadeOut(true)
        setTimeout(onBootComplete, 600)
      }, 400)
      return () => clearTimeout(fadeTimer)
    }

    const step = bootSequence[currentStep]
    const timer = setTimeout(() => {
      setCompletedSteps((prev) => [...prev, step.label])
      setCurrentStep((prev) => prev + 1)
    }, step.duration)

    return () => clearTimeout(timer)
  }, [currentStep, logoLoaded, onBootComplete])

  const progress = (currentStep / bootSequence.length) * 100

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ background: '#0a0a0a' }}
    >
      {/* Logo with glow animation */}
      <div className={`mb-8 transition-all duration-700 ${logoLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
        <div className="relative">
          {/* Pulsing glow */}
          <div
            className="absolute inset-0 rounded-full blur-2xl"
            style={{
              background: 'var(--color-accent)',
              opacity: 0.15,
              animation: 'bootGlow 2s ease-in-out infinite',
            }}
          />
          <img
            src="/logo/logo.png"
            alt="Trakend OS"
            className="relative w-72 h-auto object-contain drop-shadow-2xl"
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
          <div
            className="logo-fallback hidden w-32 h-32 rounded-2xl items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-dark))',
            }}
          >
            <span className="text-white text-5xl font-bold">T</span>
          </div>
        </div>
      </div>

      {/* Subtitle */}
      <p
        className={`text-sm mb-10 transition-all duration-700 delay-300 ${
          logoLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
        style={{ color: 'var(--color-text-secondary)' }}
      >
        Server Management Platform
      </p>

      {/* Progress Bar */}
      <div className="w-80 mb-6">
        <div
          className="w-full h-1 rounded-full overflow-hidden"
          style={{ background: 'rgba(68, 68, 68, 0.5)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${progress}%`,
              background: 'linear-gradient(90deg, var(--color-accent), var(--color-accent-light))',
              boxShadow: '0 0 10px rgba(255, 107, 53, 0.5)',
            }}
          />
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {currentStep < bootSequence.length ? bootSequence[currentStep].label : 'System ready.'}
          </span>
          <span className="text-xs font-mono" style={{ color: 'var(--color-accent)' }}>
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      {/* Boot Log */}
      <div
        className="w-96 h-48 rounded-lg overflow-hidden p-3 font-mono text-xs"
        style={{
          background: 'rgba(15, 15, 15, 0.8)',
          border: '1px solid rgba(68, 68, 68, 0.3)',
        }}
      >
        <div className="h-full overflow-y-auto" id="boot-log">
          {completedSteps.map((step, idx) => (
            <div key={idx} className="flex items-start gap-2 mb-1">
              <span style={{ color: 'var(--color-success)' }}>[OK]</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>{step}</span>
            </div>
          ))}
          {currentStep < bootSequence.length && (
            <div className="flex items-start gap-2 mb-1">
              <span className="animated-pulse" style={{ color: 'var(--color-accent)' }}>
                [..]
              </span>
              <span style={{ color: 'var(--color-text-primary)' }}>
                {bootSequence[currentStep].label}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Version info */}
      <div className="absolute bottom-6 text-center">
        <p className="text-xs" style={{ color: 'rgba(160, 160, 160, 0.5)' }}>
          Trakend OS v1.0.000 &mdash; Build {new Date().toISOString().split('T')[0].replace(/-/g, '')}
        </p>
      </div>

      <style>{`
        @keyframes bootGlow {
          0%, 100% { transform: scale(1); opacity: 0.15; }
          50% { transform: scale(1.2); opacity: 0.25; }
        }
        #boot-log {
          scrollbar-width: thin;
          scrollbar-color: rgba(68, 68, 68, 0.5) transparent;
        }
      `}</style>
    </div>
  )
}
