'use client'

import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, Clock, AlertCircle, Circle } from 'lucide-react'

type StatusType =
  | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING'
  | 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'LEFT_EARLY'
  | 'PAID' | 'OVERDUE' | 'WAIVED'
  | 'ISSUED' | 'RETURNED'
  | 'POSITIVE' | 'NEGATIVE'
  | string

interface StatusBadgeProps {
  status: StatusType
  size?: 'sm' | 'md'
  showIcon?: boolean
  className?: string
}

const STATUS_MAP: Record<string, { label: string; bg: string; text: string; icon: React.ElementType }> = {
  ACTIVE:     { label: 'Active',      bg: 'bg-green-100',  text: 'text-green-700',  icon: CheckCircle },
  INACTIVE:   { label: 'Inactive',    bg: 'bg-gray-100',   text: 'text-gray-600',   icon: Circle },
  SUSPENDED:  { label: 'Suspended',   bg: 'bg-red-100',    text: 'text-red-700',    icon: XCircle },
  PENDING:    { label: 'Pending',     bg: 'bg-yellow-100', text: 'text-yellow-700', icon: Clock },
  PRESENT:    { label: 'Present',     bg: 'bg-green-100',  text: 'text-green-700',  icon: CheckCircle },
  ABSENT:     { label: 'Absent',      bg: 'bg-red-100',    text: 'text-red-700',    icon: XCircle },
  LATE:       { label: 'Late',        bg: 'bg-yellow-100', text: 'text-yellow-700', icon: Clock },
  EXCUSED:    { label: 'Excused',     bg: 'bg-blue-100',   text: 'text-blue-700',   icon: AlertCircle },
  LEFT_EARLY: { label: 'Left Early',  bg: 'bg-orange-100', text: 'text-orange-700', icon: Clock },
  PAID:       { label: 'Paid',        bg: 'bg-green-100',  text: 'text-green-700',  icon: CheckCircle },
  OVERDUE:    { label: 'Overdue',     bg: 'bg-red-100',    text: 'text-red-700',    icon: AlertCircle },
  WAIVED:     { label: 'Waived',      bg: 'bg-gray-100',   text: 'text-gray-600',   icon: Circle },
  ISSUED:     { label: 'Issued',      bg: 'bg-blue-100',   text: 'text-blue-700',   icon: Clock },
  RETURNED:   { label: 'Returned',    bg: 'bg-green-100',  text: 'text-green-700',  icon: CheckCircle },
  POSITIVE:   { label: 'Positive',    bg: 'bg-green-100',  text: 'text-green-700',  icon: CheckCircle },
  NEGATIVE:   { label: 'Negative',    bg: 'bg-red-100',    text: 'text-red-700',    icon: XCircle },
}

export function StatusBadge({ status, size = 'md', showIcon = true, className }: StatusBadgeProps) {
  const config = STATUS_MAP[status] || {
    label: status,
    bg: 'bg-gray-100',
    text: 'text-gray-600',
    icon: Circle
  }
  const Icon = config.icon

  return (
    <span className={cn(
      'inline-flex items-center gap-1 font-medium rounded-full',
      config.bg, config.text,
      size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1',
      className
    )}>
      {showIcon && <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
      {config.label}
    </span>
  )
}
