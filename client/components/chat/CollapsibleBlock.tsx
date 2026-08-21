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
    // transitions when streaming closed, collapse automatically
    if (isClosed) {
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
  }, [isClosed]);

  const toggleCollapse = () => {
    const nextCollapsed = !collapsed;
    if (onToggle) {
      onToggle(nextCollapsed);
    }
    if (nextCollapsed) {
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
    let out: string;
    try {
      const parsed = JSON.parse(input);
      out = JSON.stringify(parsed, null, 2);
    } catch {
      out = input;
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
        backgroundColor: isThoughtOrIntent ? 'rgba(255, 255, 255, 0.03)' : themeColors.card,
        borderColor: isThoughtOrIntent ? themeColors.border : accentHex + '33',
        borderStyle: 'solid',
      }
    ]}>
      {/* Header Pressable */}
      <Pressable
        style={styles.header}
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
                { color: themeColors.text, fontSize: themeSizes.text + 1 }
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
                  style={[styles.inputLabel, { color: themeColors.textDark, fontSize: themeSizes.sub }]}
                >
                  Args: {formattedInput}
                </Text>
              </ScrollView>
            ) : null}
          </View>
        </View>
        <Text style={[styles.arrow, { color: themeColors.textDark, fontSize: themeSizes.text }]}>
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
    borderRadius: 10,
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
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safetyPillText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  content: {
    borderTopWidth: 1,
    padding: 12,
    maxWidth: '100%',
    overflow: 'hidden',
  },
});
