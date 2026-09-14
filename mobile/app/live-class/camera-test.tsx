/**
 * HALQA Mobile — Camera Test / Pre-join Check
 * Route: /live-class/camera-test
 *
 * Allows users to test their camera + mic before joining a live class.
 * Uses expo-camera for preview and expo-av for mic level detection.
 * Navigate here before /live-class/[id] when joining for the first time.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Platform, Alert
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import { showMessage } from 'react-native-flash-message';

type CheckStatus = 'idle' | 'checking' | 'ok' | 'error';

interface Check {
  label: string;
  status: CheckStatus;
  detail?: string;
}

export default function CameraTestScreen() {
  const router  = useRouter();
  const params  = useLocalSearchParams<{ classId?: string }>();
  const classId = params.classId;

  const [cameraPermission, requestCameraPermission]   = useCameraPermissions();
  const [micPermission,    requestMicPermission]       = useMicrophonePermissions();

  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('front');
  const [cameraReady,  setCameraReady]  = useState(false);
  const [micLevel,     setMicLevel]     = useState(0); // 0–100
  const [checks, setChecks] = useState<Check[]>([
    { label: 'Camera access',     status: 'idle' },
    { label: 'Microphone access', status: 'idle' },
    { label: 'Camera preview',    status: 'idle' },
    { label: 'Audio input',       status: 'idle' },
  ]);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const micTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const setCheck = (index: number, status: CheckStatus, detail?: string) => {
    setChecks(prev => prev.map((c, i) => i === index ? { ...c, status, detail } : c));
  };

  // Run all checks on mount
  useEffect(() => {
    runChecks();
    return () => {
      stopMicMonitor();
    };
  }, []);

  const runChecks = async () => {
    // 1. Camera permission
    setCheck(0, 'checking');
    try {
      const cp = cameraPermission?.granted
        ? cameraPermission
        : await requestCameraPermission();
      if (cp.granted) {
        setCheck(0, 'ok', 'Permission granted');
      } else {
        setCheck(0, 'error', 'Permission denied');
      }
    } catch {
      setCheck(0, 'error', 'Failed to request permission');
    }

    // 2. Microphone permission
    setCheck(1, 'checking');
    try {
      const mp = micPermission?.granted
        ? micPermission
        : await requestMicPermission();
      if (mp.granted) {
        setCheck(1, 'ok', 'Permission granted');
      } else {
        setCheck(1, 'error', 'Permission denied');
      }
    } catch {
      setCheck(1, 'error', 'Failed to request permission');
    }

    // 3. Camera preview — resolved when onCameraReady fires
    setCheck(2, 'checking', 'Waiting for camera…');

    // 4. Audio input monitoring
    setCheck(3, 'checking');
    await startMicMonitor();
  };

  const startMicMonitor = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.LOW_QUALITY
      );
      recordingRef.current = recording;

      // Poll metering every 200ms
      micTimerRef.current = setInterval(async () => {
        try {
          const status = await recording.getStatusAsync();
          if (status.isRecording) {
            const level = status.metering != null
              ? Math.max(0, Math.min(100, ((status.metering + 60) / 60) * 100))
              : 0;
            setMicLevel(Math.round(level));
            setCheck(3, 'ok', 'Audio input detected');
          }
        } catch {}
      }, 200);
    } catch (err) {
      setCheck(3, 'error', 'Could not start audio monitor');
    }
  };

  const stopMicMonitor = async () => {
    if (micTimerRef.current) clearInterval(micTimerRef.current);
    try {
      await recordingRef.current?.stopAndUnloadAsync();
    } catch {}
    recordingRef.current = null;
  };

  const handleCameraReady = () => {
    setCameraReady(true);
    setCheck(2, 'ok', 'Camera preview active');
  };

  const allOk = checks.every(c => c.status === 'ok');

  const handleJoin = async () => {
    await stopMicMonitor();
    if (classId) {
      router.replace(`/live-class/${classId}` as any);
    } else {
      router.push('/live-class' as any);
    }
  };

  const handleRetry = async () => {
    setChecks([
      { label: 'Camera access',     status: 'idle' },
      { label: 'Microphone access', status: 'idle' },
      { label: 'Camera preview',    status: 'idle' },
      { label: 'Audio input',       status: 'idle' },
    ]);
    setCameraReady(false);
    await stopMicMonitor();
    await runChecks();
  };

  const camGranted = cameraPermission?.granted ?? false;
  const micGranted = micPermission?.granted ?? false;

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Camera Test', headerBackTitle: 'Back' }} />

      <ScrollView contentContainerStyle={s.scroll}>
        {/* Camera preview */}
        <View style={s.cameraWrap}>
          {camGranted ? (
            <CameraView
              style={s.camera}
              facing={cameraFacing}
              onCameraReady={handleCameraReady}
            />
          ) : (
            <View style={[s.camera, s.cameraPlaceholder]}>
              <Ionicons name="videocam-off-outline" size={48} color="rgba(255,255,255,0.3)" />
              <Text style={s.cameraPlaceholderText}>Camera permission required</Text>
            </View>
          )}

          {/* Flip button */}
          {camGranted && (
            <TouchableOpacity
              style={s.flipBtn}
              onPress={() => setCameraFacing(f => f === 'front' ? 'back' : 'front')}
            >
              <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
            </TouchableOpacity>
          )}
        </View>

        {/* Mic level bar */}
        {micGranted && (
          <View style={s.micWrap}>
            <Ionicons name="mic-outline" size={16} color="#4f46e5" />
            <Text style={s.micLabel}>Mic level</Text>
            <View style={s.micBarBg}>
              <View style={[s.micBarFill, { width: `${micLevel}%` as any, backgroundColor: micLevel > 70 ? '#22c55e' : micLevel > 30 ? '#f59e0b' : '#ef4444' }]} />
            </View>
            <Text style={s.micPct}>{micLevel}%</Text>
          </View>
        )}

        {/* Check list */}
        <View style={s.checkList}>
          {checks.map((check, i) => (
            <View key={i} style={s.checkRow}>
              <View style={s.checkIcon}>
                {check.status === 'idle' && <Ionicons name="ellipse-outline" size={20} color="#d1d5db" />}
                {check.status === 'checking' && <ActivityIndicator size="small" color="#4f46e5" />}
                {check.status === 'ok' && <Ionicons name="checkmark-circle" size={20} color="#22c55e" />}
                {check.status === 'error' && <Ionicons name="close-circle" size={20} color="#ef4444" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.checkLabel, check.status === 'error' && { color: '#ef4444' }]}>
                  {check.label}
                </Text>
                {check.detail && (
                  <Text style={[s.checkDetail, check.status === 'ok' && { color: '#16a34a' }, check.status === 'error' && { color: '#dc2626' }]}>
                    {check.detail}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>

        {/* Tip */}
        {!allOk && (
          <View style={s.tipBox}>
            <Ionicons name="bulb-outline" size={16} color="#f59e0b" />
            <Text style={s.tipText}>
              Make sure camera and microphone permissions are enabled in your device Settings.
            </Text>
          </View>
        )}

        {/* Actions */}
        <View style={s.actions}>
          <TouchableOpacity style={s.retryBtn} onPress={handleRetry}>
            <Ionicons name="refresh-outline" size={16} color="#4f46e5" />
            <Text style={s.retryBtnText}>Re-run Tests</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.joinBtn, !allOk && s.joinBtnWarn]}
            onPress={allOk ? handleJoin : () => {
              Alert.alert(
                'Some checks failed',
                'You can still join, but your camera or mic may not work properly. Continue?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Join Anyway', onPress: handleJoin },
                ]
              );
            }}
          >
            <Ionicons name="videocam-outline" size={18} color="#fff" />
            <Text style={s.joinBtnText}>
              {allOk ? 'Join Class' : 'Join Anyway'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#f8fafc' },
  scroll:               { padding: 16, gap: 14 },
  cameraWrap:           { borderRadius: 16, overflow: 'hidden', position: 'relative' },
  camera:               { width: '100%', height: 240, backgroundColor: '#1a1a2e' },
  cameraPlaceholder:    { justifyContent: 'center', alignItems: 'center', gap: 8 },
  cameraPlaceholderText:{ color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  flipBtn:              { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 8 },
  micWrap:              { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  micLabel:             { fontSize: 13, fontWeight: '600', color: '#374151', minWidth: 60 },
  micBarBg:             { flex: 1, height: 8, backgroundColor: '#f1f5f9', borderRadius: 4, overflow: 'hidden' },
  micBarFill:           { height: 8, borderRadius: 4 },
  micPct:               { fontSize: 12, color: '#6b7280', minWidth: 32, textAlign: 'right' },
  checkList:            { backgroundColor: '#fff', borderRadius: 14, padding: 12, gap: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  checkRow:             { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkIcon:            { width: 24, alignItems: 'center' },
  checkLabel:           { fontSize: 14, fontWeight: '600', color: '#111827' },
  checkDetail:          { fontSize: 12, color: '#6b7280', marginTop: 2 },
  tipBox:               { flexDirection: 'row', gap: 8, backgroundColor: '#fffbeb', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#fde68a', alignItems: 'flex-start' },
  tipText:              { flex: 1, fontSize: 13, color: '#92400e', lineHeight: 18 },
  actions:              { flexDirection: 'row', gap: 10 },
  retryBtn:             { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 14, borderWidth: 1, borderColor: '#e5e7eb' },
  retryBtnText:         { fontSize: 14, fontWeight: '600', color: '#4f46e5' },
  joinBtn:              { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#4f46e5', borderRadius: 12, paddingVertical: 14 },
  joinBtnWarn:          { backgroundColor: '#f59e0b' },
  joinBtnText:          { color: '#fff', fontSize: 14, fontWeight: '800' },
});

