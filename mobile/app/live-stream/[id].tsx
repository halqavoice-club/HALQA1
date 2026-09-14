/**
 * HALQA Mobile — Public Live Stream Room
 * Route: /live-stream/[id]
 *
 * Public live streams (streamType = 'PUBLIC') share the exact same backend API,
 * database table, and room logic as school live classes.
 *
 * This screen is a redirect shim: it immediately navigates to
 * /live-class/[id] which is the canonical room screen for both stream types.
 * This way any deep link or feed card pointing to /live-stream/:id resolves
 * correctly without duplicating any room logic.
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

export default function LiveStreamRoomRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (id) {
      // Replace current history entry so back-button goes to the list, not here
      router.replace({ pathname: '/live-class/[id]', params: { id } } as any);
    }
  }, [id, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#4f46e5" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
