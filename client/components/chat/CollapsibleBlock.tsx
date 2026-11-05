import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, Animated, Platform, ScrollView } from 'react-native';
import PressableScale from '../ui/PressableScale';
import { DURATIONS, EASING } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

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
  // WF-447-04: no animated height anywhere. The clip container's height is a
  // static prop per state; the content is absolutely positioned (so it stays
  // measurable even when collapsed) and is revealed with translateY + opacity
  // on the native driver. Reduced motion keeps the fade only — no position
  // change.
  const [collapsed, setCollapsed] = useState(isClosed);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const reduceMotion = useReducedMotion();
  const expandedness = useRef(new Animated.Value(isClosed ? 0 : 1)).current;
  const contentOpacity = useRef(new Animated.Value(isClosed ? 0 : 1)).current;

  const isLarge = (input?.length || 0) > 2000 || measuredHeight > 2000;

  const settle = (toExpanded: boolean) => {
    expandedness.setValue(toExpanded ? 1 : 0);
    contentOpacity.setValue(toExpanded ? 1 : 0);
    setCollapsed(!toExpanded);
  };

  const animateTo = (toExpanded: boolean, onDone?: () => void) => {
    const config = {
      toValue: toExpanded ? 1 : 0,
      duration: DURATIONS.reveal, // 200ms ≤ 300 cap
      easing: EASING.out,
      useNativeDriver: true,
    };
    Animated.parallel([
      Animated.timing(contentOpacity, config),
      // Under reduced motion, keep the opacity change that carries
      // comprehension and drop the position change entirely.
      ...(reduceMotion ? [] : [Animated.timing(expandedness, config)]),
    ]).start(({ finished }) => {
      if (finished && onDone) onDone();
    });
  };

  // Single dispatch shared by the streaming isClosed transitions and manual
  // toggles: large blocks snap via setValue, small blocks animate.
  const syncCollapse = (targetExpanded: boolean) => {
    if (isLarge) {
      settle(targetExpanded);
    } else if (targetExpanded) {
      setCollapsed(false); // clip opens to its (static) measured height; content slides in
      animateTo(true);
    } else {
      animateTo(false, () => setCollapsed(true));
    }
  };

  useEffect(() => {
    syncCollapse(!isClosed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClosed, measuredHeight, isLarge]);

  const toggleCollapse = () => {
    const nextCollapsed = !collapsed;
    if (onToggle) {
      onToggle(nextCollapsed);
    }
    syncCollapse(!nextCollapsed);
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

  // WF-447-04: the collapse translate — content slides out of the clip window
  // (opacity fades concurrently). Native-driver-safe interpolation; the
  // output depends on the measured content height.
  const collapsedTx = expandedness.interpolate({
    inputRange: [0, 1],
    outputRange: [-measuredHeight, 0],
  });

  return (
    <View style={[
      styles.container,
      {
        backgroundColor: isThoughtOrIntent ? (themeColors.bubbleAssistant || 'rgba(217, 169, 109, 0.04)') : themeColors.card,
        borderColor: isThoughtOrIntent ? (themeColors.bubbleAssistantBorder || 'rgba(217, 169, 109, 0.18)') : accentHex + '33',
        borderStyle: 'solid',
      }
    ]}>
      {/* Header — button surface with press feedback and expanded state */}
      <PressableScale
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={(collapsed ? 'Expand ' : 'Collapse ') + title}
        style={({ pressed }) => [
          styles.header,
          pressed && { opacity: 0.8 }
        ]}
        onPress={toggleCollapse}
      >
        <View style={styles.headerTextContainer}>
          <Text style={[styles.icon, { fontSize: themeSizes.text }]}>{icon}</Text>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={[
                styles.title,
                { color: isThoughtOrIntent ? (themeColors.status || '#e0a96d') : themeColors.text, fontSize: themeSizes.text }
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
      </PressableScale>

      {/* Collapsible Content */}
      {/* WF-447-04: transform/opacity only. Clip height is static per state
          (never animated); the absolutely-positioned content stays measurable
          even when collapsed, and slides/fades on the native driver. */}
      <View style={{ overflow: 'hidden', height: collapsed ? 0 : (measuredHeight || undefined) }}>
        <Animated.View
          onLayout={onLayout}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            opacity: contentOpacity,
            transform: [{ translateY: collapsedTx }],
          }}
        >
          <View
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
      </View>
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
