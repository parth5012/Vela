import React, { useState, useEffect } from 'react';
import {
  View,
  Image,
  Text,
  StyleSheet,
  ActivityIndicator,
  StyleProp,
  ViewStyle,
  ImageStyle,
} from 'react-native';

export interface ImagePreviewProps {
  uri: string;
  thumbnailUri?: string;
  inViewport?: boolean; // When false, releases high-resolution bitmap and unmounts image to bound heap
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  width?: number | string;
  height?: number | string;
  alt?: string;
}

const MAX_IMAGE_CACHE_ENTRIES = 50;
const imageMemoryCache = new Map<string, string>();

/**
 * Prunes image memory cache to avoid unbounded bitmap retention in long chat sessions.
 */
export function pruneImageCache(maxEntries: number = MAX_IMAGE_CACHE_ENTRIES): number {
  let evicted = 0;
  while (imageMemoryCache.size > maxEntries) {
    const oldestKey = imageMemoryCache.keys().next().value;
    if (oldestKey !== undefined) {
      imageMemoryCache.delete(oldestKey);
      evicted++;
    } else {
      break;
    }
  }
  return evicted;
}

export function getImageCacheSize(): number {
  return imageMemoryCache.size;
}

export function clearImageCache(): void {
  imageMemoryCache.clear();
}

/**
 * Memory-bounded Image component that virtualizes image attachment bitmaps.
 * When scrolled outside the viewport buffer (`inViewport === false`), it unmounts
 * the native Image view to release high-resolution bitmap memory from the PSS heap,
 * rendering a lightweight placeholder instead.
 */
export function ImagePreview({
  uri,
  thumbnailUri,
  inViewport = true,
  style,
  containerStyle,
  width = 200,
  height = 140,
  alt = 'Image attachment',
}: ImagePreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (inViewport && uri) {
      if (!imageMemoryCache.has(uri)) {
        pruneImageCache(MAX_IMAGE_CACHE_ENTRIES - 1);
        imageMemoryCache.set(uri, thumbnailUri || uri);
      }
    }
  }, [inViewport, uri, thumbnailUri]);

  // When out of viewport, unmount Image entirely and display minimal placeholder
  if (!inViewport) {
    return (
      <View
        testID="image-preview-placeholder"
        style={[
          styles.placeholderContainer,
          { width: width as any, height: height as any },
          containerStyle,
        ]}
      >
        <Text style={styles.placeholderText} numberOfLines={1}>
          📷 {alt} (off-screen)
        </Text>
      </View>
    );
  }

  const activeSource = thumbnailUri || uri;

  return (
    <View
      testID="image-preview-container"
      style={[styles.container, { width: width as any, height: height as any }, containerStyle]}
    >
      <Image
        testID="image-preview-bitmap"
        source={{ uri: activeSource }}
        style={[styles.image, style]}
        resizeMode="cover"
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
      />
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#818cf8" />
        </View>
      )}
      {error && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>Failed to load image</Text>
        </View>
      )}
    </View>
  );
}

export default ImagePreview;

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  placeholderContainer: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  placeholderText: {
    color: '#a1a1aa',
    fontSize: 12,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    padding: 8,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 11,
    textAlign: 'center',
  },
});
