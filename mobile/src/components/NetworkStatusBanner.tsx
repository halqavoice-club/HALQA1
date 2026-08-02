import { View, Text, StyleSheet } from 'react-native';

export default function NetworkStatusBanner() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>No internet connection. Some features are offline.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#fef3c7',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  text: {
    color: '#92400e',
    fontSize: 13,
    fontWeight: '600',
  },
});
