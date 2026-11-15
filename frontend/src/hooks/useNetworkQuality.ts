'use client'

/**
 * HALQA — useNetworkQuality (Web, Phase 1: Network Detection)
 *
 * Uses the Network Information API + navigator.onLine + connection event
 * listeners to detect network quality in the browser.
 *
 * ADDITIVE ONLY — does not touch any existing file.
 */
import { useState, useEffect } from 'react'

export type NetworkQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'offline'

export interface NetworkQualityState {
  quality: NetworkQuality
  isOnline: boolean
  effectiveType: string     // '2g' | '3g' | '4g' | '5g' | 'slow-2g' | 'unknown'
  rtt: number | null        // ms
  downlink: number | null   // Mbps
  lowDataMode: boolean
  saveData: boolean         // user's "Data Saver" preference
}

function getConnection(): any {
  if (typeof navigator === 'undefined') return null
  return (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection || null
}

function measureQuality(): NetworkQuality {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline'

  const conn = getConnection()
  if (!conn) return 'good' // API not available — assume good

  const et = conn.effectiveType as string
  if (et === 'slow-2g' || et === '2g') return 'poor'
  if (et === '3g') return 'fair'

  // Fine-tune with rtt
  const rtt = conn.rtt as number | undefined
  if (rtt !== undefined) {
    if (rtt > 1000) return 'poor'
    if (rtt > 400)  return 'fair'
    if (rtt > 100)  return 'good'
    return 'excellent'
  }

  if (et === '4g') return 'good'
  return 'excellent'
}

const INITIAL: NetworkQualityState = {
  quality: 'good',
  isOnline: true,
  effectiveType: 'unknown',
  rtt: null,
  downlink: null,
  lowDataMode: false,
  saveData: false,
}

export function useNetworkQuality(): NetworkQualityState {
  const [state, setState] = useState<NetworkQualityState>(() => {
    if (typeof navigator === 'undefined') return INITIAL
    const conn = getConnection()
    const quality = measureQuality()
    return {
      quality,
      isOnline: navigator.onLine,
      effectiveType: conn?.effectiveType ?? 'unknown',
      rtt: conn?.rtt ?? null,
      downlink: conn?.downlink ?? null,
      lowDataMode: quality === 'poor' || quality === 'offline',
      saveData: conn?.saveData ?? false,
    }
  })

  const refresh = () => {
    const conn = getConnection()
    const quality = measureQuality()
    setState({
      quality,
      isOnline:      typeof navigator !== 'undefined' ? navigator.onLine : true,
      effectiveType: conn?.effectiveType ?? 'unknown',
      rtt:           conn?.rtt ?? null,
      downlink:      conn?.downlink ?? null,
      lowDataMode:   quality === 'poor' || quality === 'offline',
      saveData:      conn?.saveData ?? false,
    })
  }

  useEffect(() => {
    const conn = getConnection()
    conn?.addEventListener('change', refresh)
    window.addEventListener('online',  refresh)
    window.addEventListener('offline', refresh)
    return () => {
      conn?.removeEventListener('change', refresh)
      window.removeEventListener('online',  refresh)
      window.removeEventListener('offline', refresh)
    }
  }, [])

  return state
}

// Utility: map quality to recommended LiveKit audio bitrate
export function qualityToAudioBitrate(quality: NetworkQuality): number {
  switch (quality) {
    case 'excellent': return 96_000
    case 'good':      return 64_000
    case 'fair':      return 32_000
    case 'poor':      return 16_000
    case 'offline':   return 16_000
    default:          return 48_000
  }
}
