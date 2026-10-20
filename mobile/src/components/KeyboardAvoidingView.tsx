/**
 * HALQA Mobile — KeyboardAvoidingView shim
 *
 * React Native 0.81 on Android has a bug where KeyboardAvoidingView with
 * behavior="height" or behavior="padding" causes an infinite setState loop.
 *
 * This shim:
 * - On iOS: uses the native KeyboardAvoidingView normally
 * - On Android: renders a plain View (keyboard handling is done via
 *   ScrollView's keyboardShouldPersistTaps="handled" in child components)
 *
 * Usage: import KeyboardAvoidingView from '@/components/KeyboardAvoidingView'
 * (drop-in replacement for the RN one)
 */
import React from 'react';
import {
  View,
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Platform,
  KeyboardAvoidingViewProps,
} from 'react-native';

export default function KeyboardAvoidingView({ children, style, ...props }: KeyboardAvoidingViewProps) {
  if (Platform.OS === 'android') {
    // On Android with RN 0.81, skip KAV entirely — use plain View
    return <View style={style}>{children}</View>;
  }
  return (
    <RNKeyboardAvoidingView style={style} {...props}>
      {children}
    </RNKeyboardAvoidingView>
  );
}
