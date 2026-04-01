import React from 'react'

interface GaugeChartProps {
  value: number
  max: number
  size?: number
  strokeWidth?: number
  animated?: boolean
  color?: string
  backgroundColor?: string
  label?: string
  sublabel?: string
}

export const GaugeChart: React.FC<GaugeChartProps> = ({
  value,
  max,
  size = 120,
  strokeWidth = 8,
  animated = true,
  color = '#ff6b35',
  backgroundColor = '#3a3a3a',
  label,
  sublabel,
}) => {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const percentage = Math.min((value / max) * 100, 100)
  const offset = circumference - (percentage / 100) * circumference

  const cx = size / 2
  const cy = size / 2

  return (
    <div className="flex flex-col items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={backgroundColor}
          strokeWidth={strokeWidth}
          fill="none"
        />

        {/* Progress circle */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{
            transition: animated ? 'stroke-dashoffset 0.5s ease' : 'none',
          }}
        />
      </svg>

      {/* Center text */}
      <div className="absolute text-center">
        <div className="text-lg font-bold" style={{ color }}>
          {percentage.toFixed(0)}%
        </div>
        {label && <div className="text-xs text-trakend-text-secondary mt-1">{label}</div>}
        {sublabel && <div className="text-xs text-trakend-text-secondary">{sublabel}</div>}
      </div>
    </div>
  )
}
