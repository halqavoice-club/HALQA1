/**
 * Responsive scaling utilities for HALQA Mobile.
 *
 * Uses Dimensions to calculate scale factors relative to a 390×844
 * base design (iPhone 14 / typical Android reference).
 *
 * Usage:
 *   fontSize: rs(14)     → responsive font size
 *   width: rw(320)       → responsive width
 *   height: rh(60)       → responsive height
 *
 * For layout sizes (padding/margin) prefer rw/rh.
 * For font sizes use rs — it caps the scale to avoid runaway sizes on tablets.
 */
import { Dimensions, PixelRatio } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const BASE_W = 390;
const BASE_H = 844;

const wScale = SCREEN_W / BASE_W;
const hScale = SCREEN_H / BASE_H;

/** Responsive width scale */
export const rw = (size: number): number => Math.round(size * wScale);

/** Responsive height scale */
export const rh = (size: number): number => Math.round(size * hScale);

/**
 * Responsive font size — scales with width but caps the multiplier
 * at 1.3× to prevent overly large text on big-screen or large-font
 * accessibility devices.
 */
export const rs = (size: number): number => {
  const scale = Math.min(wScale, 1.3);
  return Math.round(PixelRatio.roundToNearestPixel(size * scale));
};
