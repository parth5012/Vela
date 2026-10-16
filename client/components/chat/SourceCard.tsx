/**
 * Module: client/components/chat/SourceCard
 * Intent: Web-search source card (favicon/initials + site name + title) opened via Linking (extracted from app/index.tsx).
 * Responsibilities: render one SearchSource result, open URL on press, favicon-error fallback to initials.
 * Public API: default export SourceCard({ src, colors, sizes, accentHex }).
 * Invariants: Owns its `source*` styles; dynamic colors arrive via props (aurora context stays at the screen).
 * Side Effects: Linking.openURL + Alert on failure.
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import React from 'react';
import { View, Text, Pressable, Image, Linking, Alert, StyleSheet } from 'react-native';
import type { SearchSource } from '../../utils/sourceParser';

export default function SourceCard({ src, colors, sizes, accentHex }: { src: SearchSource; colors: any; sizes: any; accentHex: string }) {
  const [imgError, setImgError] = React.useState(false);

  const handlePress = async () => {
    try {
      await Linking.openURL(src.url);
    } catch (error) {
      Alert.alert('Error', 'Could not open link in browser.');
    }
  };

  const getInitials = (siteName: string) => {
    return siteName ? siteName.substring(0, 2).toUpperCase() : 'W';
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.sourceCard,
        { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: colors.glassBorder },
        pressed && { opacity: 0.8 }
      ]}
      onPress={handlePress}
    >
      <View style={styles.sourceHeader}>
        {src.favicon && !imgError ? (
          <Image
            source={{ uri: src.favicon }}
            style={styles.sourceFavicon}
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={[styles.sourceIconFallback, { backgroundColor: accentHex + '20' }]}>
            <Text style={[styles.sourceIconFallbackText, { color: accentHex }]}>
              {getInitials(src.siteName || src.domain)}
            </Text>
          </View>
        )}
        <Text style={[styles.sourceSiteName, { color: colors.text, fontSize: sizes.sub }]} numberOfLines={1}>
          {src.siteName || 'Web Page'}
        </Text>
      </View>
      <Text style={[styles.sourceTitle, { color: colors.textMuted, fontSize: sizes.text }]} numberOfLines={2}>
        {src.title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sourceCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    width: 140,
  },
  sourceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  sourceFavicon: {
    width: 14,
    height: 14,
    borderRadius: 2,
  },
  sourceIconFallback: {
    width: 14,
    height: 14,
    borderRadius: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sourceIconFallbackText: {
    fontSize: 8,
    fontWeight: 'bold',
  },
  sourceSiteName: {
    flex: 1,
    fontWeight: '600',
  },
  sourceTitle: {
    fontWeight: '500',
  },
});
