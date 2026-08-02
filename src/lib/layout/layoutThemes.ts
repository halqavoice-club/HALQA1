/**
 * layoutThemes.ts
 *
 * Theme token definitions for the Dynamic Speaker Layout System.
 * Consumed by SeatCard and SpeakerGrid on both web and mobile.
 */

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface LayoutTheme {
  /** Page / room background */
  bg: string;
  /** Card / seat background */
  card: string;
  /** Card border */
  cardBorder: string;
  /** Primary brand color (buttons, active states) */
  primary: string;
  /** Accent color (highlights, secondary elements) */
  accent: string;
  /** Speaking indicator glow color */
  speaking: string;
  /** Muted indicator color */
  muted: string;
  /** Empty seat placeholder color */
  empty: string;
  /** CSS/RN shadow color */
  shadow: string;
  /** Whether to apply backdrop-filter blur (glassmorphism effect) */
  blur: boolean;
  /** Whether to apply a glass/frosted-glass effect on cards */
  glassmorphism: boolean;
}

// ---------------------------------------------------------------------------
// Dark theme (default — deep navy)
// ---------------------------------------------------------------------------

export const darkTheme: LayoutTheme = {
  bg: '#0f0f23',
  card: '#1a1a2e',
  cardBorder: '#2d2d4e',
  primary: '#4f46e5',
  accent: '#a5b4fc',
  speaking: '#10b981',
  muted: '#ef4444',
  empty: '#374151',
  shadow: 'rgba(0, 0, 0, 0.6)',
  blur: true,
  glassmorphism: true,
};

// ---------------------------------------------------------------------------
// Light theme
// ---------------------------------------------------------------------------

export const lightTheme: LayoutTheme = {
  bg: '#f3f4f6',
  card: '#ffffff',
  cardBorder: '#e5e7eb',
  primary: '#4f46e5',
  accent: '#6366f1',
  speaking: '#059669',
  muted: '#dc2626',
  empty: '#d1d5db',
  shadow: 'rgba(0, 0, 0, 0.12)',
  blur: false,
  glassmorphism: false,
};

// ---------------------------------------------------------------------------
// OLED theme (pure black — power-saving on OLED screens)
// ---------------------------------------------------------------------------

export const oledTheme: LayoutTheme = {
  bg: '#000000',
  card: '#0a0a0a',
  cardBorder: '#1a1a1a',
  primary: '#4f46e5',
  accent: '#a5b4fc',
  speaking: '#10b981',
  muted: '#ef4444',
  empty: '#1f2937',
  shadow: 'rgba(0, 0, 0, 0.9)',
  blur: false,
  glassmorphism: false,
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Returns the matching theme object for the given name.
 *
 * @example
 *   const theme = getTheme('dark');  // → darkTheme
 */
export function getTheme(name: 'dark' | 'light' | 'oled'): LayoutTheme {
  switch (name) {
    case 'light':
      return lightTheme;
    case 'oled':
      return oledTheme;
    case 'dark':
    default:
      return darkTheme;
  }
}
