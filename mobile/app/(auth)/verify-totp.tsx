import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator
} from 'react-native';
import { useRouter } from 'expo-router';
import { showMessage } from 'react-native-flash-message';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@/store/auth.store';
import { initSocket } from '@/lib/socket';
import { api, setAccessToken, getChallengeToken, clearChallengeToken } from '@/lib/api';

export default function VerifyTOTPScreen() {
  const router = useRouter();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  // Get challengeToken from ephemeral in-memory state (NOT from router params)
  const challengeToken = getChallengeToken();

  useEffect(() => {
    if (!challengeToken) {
      showMessage({
        message: 'Missing challenge token',
        description: 'Please log in again.',
        type: 'danger',
        duration: 4000,
      });
      router.replace('/(auth)/login' as any);
    }
  }, [challengeToken, router]);

  const handleVerify = async () => {
    if (!code.trim()) {
      showMessage({ message: 'Please enter the 6-digit code', type: 'warning' });
      return;
    }
    if (code.length !== 6 || !/^\d+$/.test(code)) {
      showMessage({ message: 'Please enter a valid 6-digit code', type: 'warning' });
      return;
    }
    if (!challengeToken) {
      showMessage({ message: 'Missing challenge token. Please log in again.', type: 'danger' });
      router.replace('/(auth)/login' as any);
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/2fa/authenticate', {
        challengeToken,
        code: code.trim(),
      });

      const { accessToken, refreshToken, user, mustChangePassword } = res.data.data;

      // Clear the ephemeral challenge token immediately after successful authentication
      clearChallengeToken();

      // Use existing token storage pattern
      setAccessToken(accessToken);
      await SecureStore.setItemAsync('halqa_refresh_token', refreshToken);

      // Set auth state using store directly
      const enriched = { ...user, name: `${user.firstName} ${user.lastName}`.trim(), avatar: user.avatarUrl ?? undefined };
      useAuthStore.getState().updateUser(enriched);
      useAuthStore.setState({ user: enriched, accessToken, isAuthenticated: true, mustChangePassword: !!mustChangePassword });

      // Initialize socket
      if (accessToken) initSocket(accessToken);

      // Navigate based on mustChangePassword
      if (mustChangePassword) {
        router.replace('/(auth)/change-password' as any);
      } else {
        router.replace('/(tabs)/feed');
      }
    } catch (err: any) {
      let msg = 'Authentication failed.';
      if (err?.response?.data?.message) {
        msg = err.response.data.message;
      } else if (err?.code === 'ECONNABORTED') {
        msg = 'Timeout. Please try again.';
      } else if (err?.code === 'ERR_NETWORK' || err?.message?.includes('Network Error')) {
        msg = 'Network error. Please check your connection.';
      } else if (err?.message) {
        msg = err.message;
      }

      // Check if challenge is expired or reused - clear and return to login
      if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('already used')) {
        // Clear the ephemeral challenge token
        clearChallengeToken();
        showMessage({
          message: msg,
          description: 'Please log in again.',
          type: 'danger',
          duration: 6000,
        });
        router.replace('/(auth)/login' as any);
      } else {
        // Invalid TOTP - allow retry (challenge remains available)
        showMessage({ message: msg, type: 'danger', duration: 4000 });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    // Clear the ephemeral challenge token and return to login
    clearChallengeToken();
    router.replace('/(auth)/login' as any);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Text style={styles.icon}>🔐</Text>
          </View>
          <Text style={styles.title}>Two-Factor Authentication</Text>
          <Text style={styles.subtitle}>
            Enter the 6-digit code from your authenticator app
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Authentication Code</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="000000"
            placeholderTextColor="#9ca3af"
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            selectTextOnFocus
          />

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleVerify}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Verify</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#4f46e5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  icon: {
    fontSize: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  form: {
    gap: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    color: '#111827',
    textAlign: 'center',
    letterSpacing: 4,
  },
  btn: {
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelBtn: {
    alignItems: 'center',
    marginTop: 16,
  },
  cancelBtnText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '600',
  },
});
