/**
 * SeatAdminSheet.tsx  (React Native)
 *
 * Bottom-sheet admin action menu for a seat.
 * Shown when a host/moderator long-presses a SeatCard.
 *
 * Requirement: 11.5
 */

import React from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  TouchableWithoutFeedback
} from 'react-native';
import type { SeatData } from '../../../../../src/lib/layout/layoutTypes';

export interface SeatAdminSheetProps {
  seat: SeatData;
  isOpen: boolean;
  onClose: () => void;
  onLockSeat: () => void;
  onReserveSeat: () => void;
  onSwapSeat: () => void;
  onPinSpeaker: () => void;
}

export function SeatAdminSheet({
  seat,
  isOpen,
  onClose,
  onLockSeat,
  onReserveSeat,
  onSwapSeat,
  onPinSpeaker,
}: SeatAdminSheetProps) {
  const displayName = seat.displayName || seat.userId.slice(0, 8);

  const actions = [
    { label: seat.isLocked ? '🔓 Unlock Seat' : '🔒 Lock Seat', onPress: onLockSeat },
    { label: '📌 Reserve Seat', onPress: onReserveSeat },
    { label: '🔄 Swap Seat', onPress: onSwapSeat },
    { label: '📍 Pin Speaker', onPress: onPinSpeaker },
  ];

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose} accessibilityLabel="Close menu">
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <View style={styles.sheet}>
        {/* Handle bar */}
        <View style={styles.handle} />

        <Text style={styles.title}>
          {seat.isEmpty ? 'Empty Seat' : displayName}
        </Text>

        {actions.map(({ label, onPress }) => (
          <Pressable
            key={label}
            onPress={() => { onPress(); onClose(); }}
            accessibilityRole="button"
            style={styles.actionRow}
          >
            <Text style={styles.actionLabel}>{label}</Text>
          </Pressable>
        ))}

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          style={[styles.actionRow, styles.cancelRow]}
        >
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#4b5563',
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#e5e7eb',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  actionRow: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2d2d4e',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 6,
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 14,
    color: '#e5e7eb',
  },
  cancelRow: {
    borderColor: 'transparent',
    marginTop: 4,
  },
  cancelLabel: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
});

