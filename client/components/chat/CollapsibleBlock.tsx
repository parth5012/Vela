import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, Animated, Platform, ScrollView } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import PressableScale from '../ui/PressableScale';
import { DURATIONS, EASING, PRESS_SCALE } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { ASTRYX_RADII } from '../../utils/theme';
import { triggerHaptic } from '../../utils/haptics';

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
    if (reduceMotion) {
      expandedness.setValue(toExpanded ? 1 : 0);
    }
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
    triggerHaptic('selection');
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

  let title = `Executed: ${name || 'Tool'}`;

  if (isThought) {
    title = 'Thought Process';
  } else if (isIntent) {
    title = 'Intent';
  } else if (isSkill) {
    title = `Executing: ${name || 'Skill'}`;
  }

  const isThoughtOrIntent = isThought || isIntent;
  const iconColor = isThoughtOrIntent ? (themeColors.status || '#e0a96d') : (accentHex || '#801D78');

  const renderIcon = () => {
    if (isThought) {
      return (
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
          <Path d="M19 3l.6 1.4L21 5l-1.4.6L19 7l-.6-1.4L17 5l1.4-.6L19 3z" />
        </Svg>
      );
    }
    if (isIntent) {
      return (
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Circle cx="12" cy="12" r="10" />
          <Circle cx="12" cy="12" r="6" />
          <Circle cx="12" cy="12" r="2" />
        </Svg>
      );
    }
    if (isSkill) {
      return (
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </Svg>
      );
    }
    return (
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </Svg>
    );
  };

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
        ? { label: 'Auto', bg: '#10B981', color: '#ffffff' }
        : safetyTier === 'ask'
          ? { label: 'Ask', bg: '#F59E0B', color: '#111827' }
          : { label: 'Blocked', bg: '#EF4444', color: '#ffffff' }
      : null;

  // WF-447-04: the collapse translate — content slides out of the clip window
  // (opacity fades concurrently). Native-driver-safe interpolation; the
  // output depends on the measured content height.
  const collapsedTx = expandedness.interpolate({
    inputRange: [0, 1],
    outputRange: [-measuredHeight, 0],
  });

  const arrowRotation = expandedness.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
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
        scaleTo={PRESS_SCALE.button}
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={(collapsed ? 'Expand ' : 'Collapse ') + title}
        style={({ pressed }) => [
          styles.header,
          pressed && { opacity: 0.8 }
        ]}
        onPress={toggleCollapse}
      >
        <View style={styles.headerTextContainer}>
          <View style={[styles.iconWrapper, { backgroundColor: isThoughtOrIntent ? (themeColors.status || '#e0a96d') + '15' : (accentHex || '#801D78') + '15' }]}>
            {renderIcon()}
          </View>
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
        <Animated.Text
          style={[
            styles.arrow,
            { color: themeColors.textMuted || themeColors.textDark || '#6B7280', fontSize: 12 },
            reduceMotion ? null : { transform: [{ rotate: arrowRotation }] },
          ]}
        >
          {reduceMotion ? (collapsed ? '▼' : '▲') : '▼'}
        </Animated.Text>
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
    borderRadius: ASTRYX_RADII.card,
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
    gap: 10,
  },
  iconWrapper: {
    width: 28,
    height: 28,
    borderRadius: ASTRYX_RADII.element,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  inputLabel: {
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  arrow: {
    marginLeft: 8,
  },
  safetyPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: ASTRYX_RADII.inner,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safetyPillText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
    letterSpacing: 0.4,
  },
  content: {
    borderTopWidth: 1,
    padding: 12,
    maxWidth: '100%',
    overflow: 'hidden',
  },
});
