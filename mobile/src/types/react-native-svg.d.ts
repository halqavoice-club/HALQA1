/**
 * Minimal type stub for react-native-svg.
 * Replace with the real package when react-native-svg is installed.
 */
declare module 'react-native-svg' {
  import React from 'react';
  interface CommonProps { style?: any; [key: string]: any }
  export const Svg: React.FC<CommonProps & { width?: number | string; height?: number | string; viewBox?: string }>;
  export const Path: React.FC<CommonProps & { d?: string; stroke?: string; strokeWidth?: number; fill?: string; strokeLinecap?: string; strokeLinejoin?: string }>;
  export const G: React.FC<CommonProps>;
  export const Circle: React.FC<CommonProps & { cx?: number; cy?: number; r?: number }>;
  export const Rect: React.FC<CommonProps & { x?: number; y?: number; width?: number; height?: number }>;
  export const Line: React.FC<CommonProps & { x1?: number; y1?: number; x2?: number; y2?: number }>;
  export const Text: React.FC<CommonProps>;
  export default Svg;
}
