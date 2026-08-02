/**
 * HALQA Mobile — Education Section Layout
 * Provides the Stack navigator with consistent headers for all education screens.
 */
import { Stack } from 'expo-router';

export default function EducationLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle:      { backgroundColor: '#fff' },
        headerTintColor:  '#4f46e5',
        headerTitleStyle: { fontWeight: '700', color: '#1e293b' },
        headerBackTitle:  'Back',
      }}
    >
      <Stack.Screen name="attendance"    options={{ title: 'Attendance' }} />
      <Stack.Screen name="grades"        options={{ title: 'Grades' }} />
      <Stack.Screen name="behavior"      options={{ title: 'Behavior' }} />
      <Stack.Screen name="fees"          options={{ title: 'Fees' }} />
      <Stack.Screen name="schedule"      options={{ title: 'Schedule' }} />
      <Stack.Screen name="library"       options={{ title: 'Library' }} />
      <Stack.Screen name="announcements" options={{ title: 'Announcements' }} />
      <Stack.Screen name="reports"       options={{ title: 'Reports' }} />
    </Stack>
  );
}
