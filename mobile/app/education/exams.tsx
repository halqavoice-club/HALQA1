/**
 * HALQA Mobile — Exams Screen
 * Route: /education/exams
 *
 * Exams are managed through the assignments screen with the 'exams' tab active.
 * This screen auto-redirects to assignments.
 */
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';

export default function ExamsScreen() {
  const router = useRouter();

  useEffect(() => {
    // Assignments screen has an exams tab built in
    router.replace('/education/assignments' as any);
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9fafb' }}>
      <ActivityIndicator color="#4f46e5" size="large" />
    </View>
  );
}
