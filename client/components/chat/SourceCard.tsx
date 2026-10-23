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
        { backgroundColor: 'rgba(0,0,0,0.3)', borderColor: colors.glassBorder },
        pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] }
      ]}
      onPress={handlePress}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
    >
      <View style={styles.sourceHeader}>
        {src.favicon && !imgError ? (
          <Image
            source={{ uri: src.favicon }}
            style={styles.sourceFavicon}
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={[styles.sourceIconFallback, { backgroundColor: accentHex + '25' }]}>
            <Text style={[styles.sourceIconFallbackText, { color: accentHex }]}>
              {getInitials(src.siteName || src.domain)}
            </Text>
          </View>
        )}
        <Text style={[styles.sourceSiteName, { color: colors.text, fontSize: sizes.sub }]} numberOfLines={1}>
          {src.siteName || 'Web Page'}
        </Text>
      </View>
      <Text style={[styles.sourceTitle, { color: colors.textMuted, fontSize: sizes.text - 1, lineHeight: Math.round((sizes.text - 1) * 1.3) }]} numberOfLines={2}>
        {src.title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sourceCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    width: 148,
    minHeight: 56,
  },
  sourceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  sourceFavicon: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
  sourceIconFallback: {
    width: 16,
    height: 16,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sourceIconFallbackText: {
    fontSize: 9,
    fontWeight: 'bold',
  },
  sourceSiteName: {
    flex: 1,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  sourceTitle: {
    fontWeight: '500',
  },
});
