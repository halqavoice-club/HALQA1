/**
 * HALQA Mobile — Root Layout
 * Handles: session restore, font loading, query client, navigation, deep links
 *
 * Deep link scheme: halqa://
 * Universal links:  https://halqa.app (configure in eas.json + apple-app-site-association)
 *
 * Supported deep link routes (handled automatically by expo-router file structure):
 *   halqa://feed                  → app/(tabs)/feed.tsx
 *   halqa://voice/[id]            → app/voice/[id].tsx
 *   halqa://live-class/[id]       → app/live-class/[id].tsx
 *   halqa://community/[slug]      → app/community/[slug].tsx
 *   halqa://profile/[id]          → app/profile/[id].tsx
 *   halqa://post/[id]             → app/post/[id].tsx
 *   halqa://dm/[id]               → app/dm/[id].tsx
 *   halqa://story/[userId]        → app/story/[userId].tsx
 *   halqa://hashtag/[tag]         → app/hashtag/[tag].tsx
 */
// registerGlobals() must be called before any other imports to patch WebRTC
// globals into the JS environment before React Native modules initialize.
// See: https://docs.livekit.io/client-sdk-react-native
import { registerGlobals } from '@livekit/react-native';
registerGlobals();

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import FlashMessage from 'react-native-flash-message';
import { queryClient } from '@/lib/queryClient';
import { useAuthStore } from '@/store/auth.store';
import { authEventEmitter, applyURLOverride, API_URL_OVERRIDE_KEY } from '@/lib/api';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import { useAppLifecycle } from '@/lib/appLifecycle';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import NetworkStatusBanner from '@/components/NetworkStatusBanner';
import { PKInvitationModal } from '@/components/pk/PKInvitationModal';

SplashScreen.preventAutoHideAsync();

// ─── Deep link prefix ─────────────────────────────────────────────────────────
// expo-router handles routing automatically — this export is for reference
// and for use in components that need to construct deep link URLs.
export const APP_SCHEME = 'halqa';
export const createDeepLink = (path: string) => Linking.createURL(path);

export default function RootLayout() {
  const { restoreSession, logout } = useAuthStore();

  const [fontsLoaded] = useFonts({
    // Add custom fonts here if needed
  });

  useAppLifecycle();
  const network = useNetworkStatus();

  useEffect(() => {
    // 1. Apply any stored URL override BEFORE restoring session
    SecureStore.getItemAsync(API_URL_OVERRIDE_KEY).then(override => {
      if (override) applyURLOverride(override);
    }).catch(() => {}).finally(() => {
      // 2. Restore session after URL is resolved
      restoreSession().finally(() => {
        if (fontsLoaded) SplashScreen.hideAsync();
      });
    });
  }, [fontsLoaded]);

  // Listen for auth errors (401 after refresh fails → force logout)
  // Use getState() to avoid stale closure / re-registration loops
  useEffect(() => {
    const unsub = authEventEmitter.on((event) => {
      if (event === 'logout') {
        useAuthStore.getState().logout();
      }
    });
    return unsub;
  }, []); // empty deps — authEventEmitter is module-level stable

  // Listen for deep links while app is foregrounded
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      // expo-router handles navigation automatically.
      // This listener is here for custom handling (analytics, logging etc.)
      if (__DEV__) console.log('[deeplink] Received:', url);
    });
    return () => subscription.remove();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          {(!network.isConnected || !network.isInternetReachable) && <NetworkStatusBanner />}
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)"  options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)"  options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="auto" />
          <FlashMessage position="top" />
          {/* Global PK invitation modal — active on every screen */}
          <PKInvitationModal />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
