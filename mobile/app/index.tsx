/**
 * Root redirect — sends to tabs if authenticated, login if not
 */
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';
import { View, ActivityIndicator } from 'react-native';

export default function Index() {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#4f46e5' }}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  return <Redirect href={isAuthenticated ? '/(tabs)/feed' : '/(auth)/login'} />;
}
