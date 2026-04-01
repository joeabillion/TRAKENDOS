import React from 'react'
import { LineChart, Line, ResponsiveContainer } from 'recharts'

interface SparklineChartProps {
  data: Array<{
    value: number
  }>
  color?: string
  height?: number
  width?: number
}

export const SparklineChart: React.FC<SparklineChartProps> = ({
  data,
  color = '#ff6b35',
  height = 40,
  width = 100,
}) => {
  if (!data || data.length === 0) {
    return <div style={{ width, height }} className="bg-trakend-surface rounded" />
  }

  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart
        data={data}
        margin={{
          top: 5,
          right: 5,
          left: -20,
          bottom: 5,
        }}
      >
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
