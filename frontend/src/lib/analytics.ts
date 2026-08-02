'use client'

interface AnalyticsEvent {
  event: string
  properties?: Record<string, any>
  userId?: string
  sessionId?: string
}

class Analytics {
  private initialized = false
  private queue: AnalyticsEvent[] = []
  private sessionId: string

  constructor() {
    this.sessionId = this.generateSessionId()
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  initialize() {
    if (this.initialized) return
    
    if (typeof window !== 'undefined') {
      this.initialized = true
      this.processQueue()
    }
  }

  track(event: string, properties?: Record<string, any>) {
    const analyticsEvent: AnalyticsEvent = {
      event,
      properties: {
        ...properties,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        userAgent: navigator.userAgent,
      },
      sessionId: this.sessionId,
    }

    if (this.initialized) {
      this.send(analyticsEvent)
    } else {
      this.queue.push(analyticsEvent)
    }
  }

  trackPageView(page: string, properties?: Record<string, any>) {
    this.track('page_view', {
      page,
      ...properties,
    })
  }

  trackEvent(event: string, properties?: Record<string, any>) {
    this.track(event, properties)
  }

  trackError(error: Error, context?: Record<string, any>) {
    this.track('error', {
      error: error.message,
      stack: error.stack,
      ...context,
    })
  }

  trackPerformance(metricName: string, value: number, properties?: Record<string, any>) {
    this.track('performance', {
      metric: metricName,
      value,
      ...properties,
    })
  }

  private send(event: AnalyticsEvent) {
    // Send to your analytics service
    // This is a placeholder - integrate with your analytics provider
    if (process.env.NODE_ENV === 'development') {
      console.log('[Analytics]', event)
    }

    // Example: Send to backend (disabled for now - route not implemented)
    // fetch('/api/v1/analytics/events', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(event),
    // }).catch((err) => {
    //   console.error('[Analytics] Failed to send event:', err)
    // })
  }

  private processQueue() {
    while (this.queue.length > 0) {
      const event = this.queue.shift()
      if (event) {
        this.send(event)
      }
    }
  }
}

export const analytics = new Analytics()

// React Hook
export function useAnalytics() {
  return {
    trackPageView: analytics.trackPageView.bind(analytics),
    trackEvent: analytics.trackEvent.bind(analytics),
    trackError: analytics.trackError.bind(analytics),
    trackPerformance: analytics.trackPerformance.bind(analytics),
  }
}
