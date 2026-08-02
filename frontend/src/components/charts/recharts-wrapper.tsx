'use client'

// Re-export recharts components — this file is client-only
// Import this instead of recharts directly to avoid SSR issues
export {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, AreaChart, Area
} from 'recharts'
