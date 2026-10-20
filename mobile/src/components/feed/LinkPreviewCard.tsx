/**
 * HALQA Mobile — LinkPreviewCard
 * Shows scraped link metadata (title, description, image, hostname) embedded in a post.
 *
 * Props match the backend-scraped fields stored on Post:
 *   linkUrl, linkTitle, linkDescription?, linkImage?
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Linking
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  linkUrl: string;
  linkTitle: string;
  linkDescription?: string | null;
  linkImage?: string | null;
}

function getHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

export function LinkPreviewCard({ linkUrl, linkTitle, linkDescription, linkImage }: Props) {
  const [imgError, setImgError] = useState(false);
  const hostname = getHostname(linkUrl);

  const handlePress = async () => {
    try {
      const canOpen = await Linking.canOpenURL(linkUrl);
      if (canOpen) await Linking.openURL(linkUrl);
    } catch { /* silent */ }
  };

  return (
    <TouchableOpacity
      style={lp.container}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      {/* Image (if available and not errored) */}
      {linkImage && !imgError && (
        <Image
          source={{ uri: linkImage }}
          style={lp.image}
          resizeMode="cover"
          onError={() => setImgError(true)}
        />
      )}

      {/* Metadata */}
      <View style={lp.meta}>
        <View style={lp.hostRow}>
          <Ionicons name="link-outline" size={11} color="#94a3b8" />
          <Text style={lp.hostname} numberOfLines={1}>{hostname}</Text>
        </View>
        <Text style={lp.title} numberOfLines={2}>{linkTitle}</Text>
        {linkDescription ? (
          <Text style={lp.description} numberOfLines={2}>{linkDescription}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const lp = StyleSheet.create({
  container:   { borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', overflow: 'hidden', marginBottom: 8 },
  image:       { width: '100%', height: 160, backgroundColor: '#f1f5f9' },
  meta:        { padding: 10, backgroundColor: '#f8fafc', gap: 3 },
  hostRow:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hostname:    { fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 },
  title:       { fontSize: 13, fontWeight: '700', color: '#1e293b', lineHeight: 18 },
  description: { fontSize: 12, color: '#64748b', lineHeight: 17 },
});

