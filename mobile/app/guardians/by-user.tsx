/**
 * Guardian lookup by userId → redirect to /guardians/:id
 * Used from the School Members screen where only userId is available.
 */

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export default function GuardianByUserScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['guardian-by-user', userId],
    queryFn: () => api.get('/guardians', { params: { search: '', limit: 100 } }).then(r => {
      const guardians = r.data.data ?? [];
      return guardians.find((g: any) => g.user?.id === userId) ?? null;
    }),
    enabled: !!userId,
  });

  React.useEffect(() => {
    if (data?.id) {
      router.replace({ pathname: '/guardians/[id]', params: { id: data.id } } as any);
    } else if (!isLoading && (isError || data === null)) {
      router.back();
    }
  }, [data, isLoading, isError]);

  return (
    <>
      <Stack.Screen options={{ title: 'Guardian', headerTintColor: '#ea580c' }} />
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#ea580c" />
      </View>
    </>
  );
}
