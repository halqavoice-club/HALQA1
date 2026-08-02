import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options
  }).format(new Date(date))
}

export function formatTime(date: string | Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(date))
}

export function getInitials(firstName: string, lastName: string) {
  return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase()
}

export function truncate(str: string, length: number) {
  return str.length > length ? str.substring(0, length) + '...' : str
}

export function getGradeColor(percentage: number): string {
  if (percentage >= 90) return 'text-green-600'
  if (percentage >= 80) return 'text-blue-600'
  if (percentage >= 70) return 'text-yellow-600'
  if (percentage >= 60) return 'text-orange-600'
  return 'text-red-600'
}

export function getBehaviorColor(points: number): string {
  if (points > 0) return 'text-green-600'
  if (points < 0) return 'text-red-600'
  return 'text-gray-600'
}
