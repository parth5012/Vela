import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Platform, ScrollView } from 'react-native';

interface CollapsibleBlockProps {
  type: 'thought' | 'tool_call' | 'intent' | 'skill';
  name?: string;
  input?: string;
  isClosed: boolean;
  themeColors: any;
  themeSizes: any;
  accentHex: string;
  children: React.ReactNode;
  onToggle?: (collapsed: boolean) => void;
  safetyTier?: 'auto' | 'ask' | 'blocked';
}

export default function CollapsibleBlock({
  type,
  name,
  input,
  isClosed,
  themeColors,
  themeSizes,
  accentHex,
  children,
  onToggle,
  safetyTier
}: CollapsibleBlockProps) {
  // If streaming (unclosed) default expanded. Once closed, collapse it.
  const [collapsed, setCollapsed] = useState(isClosed);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const animatedValue = useRef(new Animated.Value(isClosed ? 0 : 1)).current;
  const contentOpacity = useRef(new Animated.Value(isClosed ? 0 : 1)).current;

  useEffect(() => {
    const isLarge = (input?.length || 0) > 2000 || measuredHeight > 2000;
    // transitions when streaming is closed, collapse automatically
    if (isClosed) {
      if (isLarge) {
        animatedValue.setValue(0);
        contentOpacity.setValue(0);
        setCollapsed(true);
      } else {
        Animated.parallel([
          Animated.timing(animatedValue, {
            toValue: 0,
            duration: 200,
            useNativeDriver: false, // height is a layout prop; keep on JS driver
          }),
          Animated.timing(contentOpacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true, // opacity can run on the native driver
          }),
        ]).start(() => {
          setCollapsed(true);
        });
      }
    } else {
      if (isLarge) {
        animatedValue.setValue(1);
        contentOpacity.setValue(1);
        setCollapsed(false);
      } else {
        setCollapsed(false);
        Animated.parallel([
          Animated.timing(animatedValue, {
            toValue: 1,
            duration: 200,
            useNativeDriver: false, // height is a layout prop; keep on JS driver
          }),
          Animated.timing(contentOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true, // opacity can run on the native driver
          }),
        ]).start();
      }
    }
  }, [isClosed, measuredHeight]);

  const toggleCollapse = () => {
    const nextCollapsed = !collapsed;
    if (onToggle) {
      onToggle(nextCollapsed);
    }
    const isLarge = (input?.length || 0) > 2000 || measuredHeight > 2000;
    if (nextCollapsed) {
      if (isLarge) {
        animatedValue.setValue(0);
        contentOpacity.setValue(0);
        setCollapsed(true);
      } else {
        Animated.parallel([
          Animated.timing(animatedValue, {
            toValue: 0,
            duration: 200,
            useNativeDriver: false, // height is a layout prop; keep on JS driver
          }),
          Animated.timing(contentOpacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true, // opacity can run on the native driver
          }),
        ]).start(() => {
          setCollapsed(true);
        });
      }
    } else {
      if (isLarge) {
        animatedValue.setValue(1);
        contentOpacity.setValue(1);
        setCollapsed(false);
      } else {
        setCollapsed(false);
        Animated.parallel([
          Animated.timing(animatedValue, {
            toValue: 1,
            duration: 200,
            useNativeDriver: false, // height is a layout prop; keep on JS driver
          }),
          Animated.timing(contentOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true, // opacity can run on the native driver
          }),
        ]).start();
      }
    }
  };

  const onLayout = (event: any) => {
    const { height } = event.nativeEvent.layout;
    if (height > 0 && height !== measuredHeight) {
      setMeasuredHeight(height);
    }
  };

  const isThought = type === 'thought';
  const isIntent = type === 'intent';
  const isSkill = type === 'skill';

  let icon = '⚙️';
  let title = `Executed: ${name || 'Tool'}`;

  if (isThought) {
    icon = '🧠';
    title = 'Thought Process';
  } else if (isIntent) {
    icon = '🎯';
    title = 'Intent';
  } else if (isSkill) {
    icon = '🧩';
    title = `Executing: ${name || 'Skill'}`;
  }

  const isThoughtOrIntent = isThought || isIntent;

  // #160: Pretty-print JSON args: try JSON.parse then 2-space stringify else raw; limit 800 chars.
  const formattedInput = useMemo(() => {
    if (!input) return null;
    let strInput = typeof input === 'string' ? input : String(input);
    let out: string;
    try {
      const parsed = JSON.parse(strInput);
      out = JSON.stringify(parsed, null, 2);
    } catch {
      out = strInput;
    }
    if (out.length > 800) {
      out = out.slice(0, 800) + '... truncated';
    }
    return out;
  }, [input]);

  // #160: safety pill config when type === 'tool_call'
  const safetyConfig =
    type === 'tool_call' && safetyTier
      ? safetyTier === 'auto'
        ? { label: 'Auto', bg: '#22c55e', color: '#ffffff' }
        : safetyTier === 'ask'
          ? { label: 'Ask', bg: '#eab308', color: '#111827' }
          : { label: 'Blocked', bg: '#ef4444', color: '#ffffff' }
      : null;

  // Interpolate height on the JS driver (height is a layout prop).
  // Opacity is its own Animated.Value driven by the native driver (see above).
  const contentHeight = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, measuredHeight],
  });

  return (
    <View style={[
      styles.container,
      {
        backgroundColor: isThoughtOrIntent ? 'rgba(217, 169, 109, 0.04)' : themeColors.card,
        borderColor: isThoughtOrIntent ? 'rgba(217, 169, 109, 0.18)' : accentHex + '33',
        borderStyle: 'solid',
      }
    ]}>
      {/* Header Pressable */}
      <Pressable
        style={({ pressed }) => [
          styles.header,
          pressed && { opacity: 0.8 }
        ]}
        onPress={toggleCollapse}
        accessibilityRole="button"
        accessibilityLabel={(collapsed ? 'Expand ' : 'Collapse ') + title}
      >
        <View style={styles.headerTextContainer}>
          <Text style={[styles.icon, { fontSize: themeSizes.text }]}>{icon}</Text>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={[
                styles.title,
                { color: isThoughtOrIntent ? '#e0a96d' : themeColors.text, fontSize: themeSizes.text }
              ]}>
                {title}
              </Text>
              {safetyConfig ? (
                <View style={[styles.safetyPill, { backgroundColor: safetyConfig.bg }]}>
                  <Text style={[styles.safetyPillText, { color: safetyConfig.color }]}>
                    {safetyConfig.label}
                  </Text>
                </View>
              ) : null}
            </View>
            {formattedInput ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 2, maxWidth: '100%' }}>
                <Text
                  style={[styles.inputLabel, { color: themeColors.textDark, fontSize: themeSizes.sub - 1 }]}
                >
                  Args: {formattedInput}
                </Text>
              </ScrollView>
            ) : null}
          </View>
        </View>
        <Text style={[styles.arrow, { color: themeColors.textDark, fontSize: themeSizes.sub }]}>
          {collapsed ? '▼' : '▲'}
        </Text>
      </Pressable>

      {/* Collapsible Content */}
      {/* Collapsible Content: opacity on its own Animated.View (native driver);
          height stays on the inner Animated.View (JS driver - layout prop).
          RN native validation rejects layout props inside native-driven styles. */}
      <Animated.View style={{ opacity: contentOpacity }}>
        <Animated.View
          style={{
            height: contentHeight,
            overflow: 'hidden',
          }}
        >
          <View
            onLayout={onLayout}
            style={[
              styles.content,
              {
                borderTopColor: themeColors.border,
                backgroundColor: isThoughtOrIntent ? 'transparent' : 'rgba(0, 0, 0, 0.15)',
              },
            ]}
          >
            {children}
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1,
    marginVertical: 6,
    overflow: 'hidden',
    alignSelf: 'stretch',
    maxWidth: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
  },
  headerTextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  icon: {
    marginRight: 2,
  },
  title: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  inputLabel: {
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  arrow: {
    fontWeight: 'bold',
    marginLeft: 8,
  },
  safetyPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safetyPillText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
    letterSpacing: 0.3,
  },
  content: {
    borderTopWidth: 1,
    padding: 12,
    maxWidth: '100%',
    overflow: 'hidden',
  },
});
