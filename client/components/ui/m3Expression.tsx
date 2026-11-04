import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';

// Material 3 Expressive widget kit: odometer counter, wavy progress ring,
// staggered weekly chart, bouncy pressables and shape-morphing badges.
// All components take explicit colors so they inherit the active Aurora theme.

/* ------------------------------- Odometer -------------------------------- */

export function Odometer({
  value,
  color = '#171D1B',
  fontSize = 34,
}: {
  value: number;
  color?: string;
  fontSize?: number;
}) {
  const text = Math.round(value).toLocaleString();
  return (
    <View style={styles.row}>
      {text.split('').map((char, i) => (
        <AnimatedDigit
          key={`${i}-${char}`}
          char={char}
          color={color}
          fontSize={fontSize}
        />
      ))}
    </View>
  );
}

function AnimatedDigit({
  char,
  color,
  fontSize,
}: {
  char: string;
  color: string;
  fontSize: number;
}) {
  const translateY = useRef(new Animated.Value(12)).current;
  const scaleY = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    // Re-boll each time the digit content changes.
    translateY.setValue(12);
    scaleY.setValue(0.8);
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        bounciness: 9,
        speed: 0.7,
        useNativeDriver: true,
      }),
      Animated.spring(scaleY, {
        toValue: 1,
        bounciness: 8,
        speed: 0.7,
        useNativeDriver: true,
      }),
    ]).start();
  }, [char, translateY, scaleY]);

  return (
    <Animated.Text
      style={[
        styles.omDigit,
        { color, fontSize, transform: [{ translateY }, { scaleY }] },
      ]}
    >
      {char}
    </Animated.Text>
  );
}

/* ------------------------------- WavyRing -------------------------------- */

export function WavyRing({
  progress,
  size = 168,
  stroke = 14,
  acc1 = '#00A88E',
  acc2 = '#6EE7C8',
  trackColor = 'rgba(21,23,26,0.06)',
  caption,
  captionColor = '#3F4946',
}: {
  progress: number;
  size?: number;
  stroke?: number;
  acc1?: string;
  acc2?: string;
  trackColor?: string;
  caption?: string;
  captionColor?: string;
}) {
  const animation = useRef(new Animated.Value(0)).current;
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const listener = animation.addListener(({ value }) => setCurrent(value));
    Animated.timing(animation, {
      toValue: Math.max(0, Math.min(1, progress)),
      duration: 1100,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // strokeDasharray is a layout prop
    }).start();
    return () => {
      animation.removeListener(listener);
    };
  }, [progress, animation]);

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = current * circumference;
  const gradientId = `m3ring-${size}-${stroke}`;

  return (
    <View style={{ width: size, height: size, alignSelf: 'center' }}>
      <Svg width={size} height={size}>
        <Defs>
          <SvgGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={acc1} />
            <Stop offset="100%" stopColor={acc2} />
          </SvgGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {/* Wavy inner texture ring */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius - stroke * 1.7}
          stroke={trackColor}
          strokeWidth={stroke / 3}
          fill="none"
          strokeDasharray="2 5"
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={[styles.ringValue, { color: captionColor }]}>
          {Math.round(current * 100)}%
        </Text>
        {caption ? (
          <Text style={[styles.ringCaption, { color: captionColor }]}>
            {caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/* ----------------------------- WeeklyChart ------------------------------- */

const BAR_MAX_HEIGHT = 76;
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function WeeklyChart({
  data,
  goal,
  barColor = '#00A88E',
  metColor = '#10B981',
  idleColor = 'rgba(21,23,26,0.06)',
  labelColor = 'rgba(21,23,26,0.45)',
}: {
  data: number[];
  goal: number;
  barColor?: string;
  metColor?: string;
  idleColor?: string;
  labelColor?: string;
}) {
  return (
    <View style={styles.chartRow}>
      {data.map((value, i) => {
        const height = Math.max(4, (value / goal) * BAR_MAX_HEIGHT);
        const met = value >= goal;
        return (
          <View key={i} style={styles.dayColumn}>
            <View style={styles.barArea}>
              <AnimatedBar
                height={height}
                color={met ? metColor : value > 0 ? barColor : idleColor}
              />
              {met ? (
                <View style={[styles.seal, { backgroundColor: metColor }]}>
                  <Text style={styles.sealText}>✓</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.barLabel, { color: labelColor }]}>
              {DAY_LABELS[i % DAY_LABELS.length]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function AnimatedBar({ height, color }: { height: number; color: string }) {
  const scaleY = useRef(new Animated.Value(0.05)).current;

  useEffect(() => {
    // Stagger handled by the caller via mount order; keep a spring bounce.
    Animated.spring(scaleY, {
      toValue: 1,
      bounciness: 9,
      speed: 0.5,
      useNativeDriver: true,
    }).start();
  }, [scaleY]);

  return (
    <Animated.View
      style={[styles.bar, { height, backgroundColor: color, transform: [{ scaleY }] }]}
    />
  );
}

/* --------------------------- BouncyPressable ----------------------------- */

export function BouncyPressable({
  onPress,
  style,
  children,
}: {
  onPress?: () => void;
  style?: object;
  children?: React.ReactNode;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        Animated.spring(scale, { toValue: 0.93, speed: 60, useNativeDriver: true }).start();
      }}
      onPressOut={() => {
        Animated.spring(scale, { toValue: 1, bounciness: 9, useNativeDriver: true }).start();
      }}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/* ------------------------------ ShapeBadge ------------------------------- */

const BADGE_SIZE = 56;
// M3 expressive corner sweep: squircle-ish → circle → sharp squircle,
// morphing continuously with a spring (borderRadius + slight rotation).
const BADGE_SHAPES = [
  { radius: 16, rotate: '0deg' },
  { radius: BADGE_SIZE / 2, rotate: '6deg' },
  { radius: 8, rotate: '-4deg' },
];

export function ShapeBadge({
  emoji,
  label,
  tintColor = 'rgba(0,168,142,0.15)',
}: {
  emoji: string;
  label?: string;
  tintColor?: string;
}) {
  const [shapeIndex, setShapeIndex] = useState(0);
  const radius = useRef(new Animated.Value(BADGE_SHAPES[0].radius)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const shape = BADGE_SHAPES[shapeIndex];
    Animated.parallel([
      Animated.spring(radius, {
        toValue: shape.radius,
        bounciness: 8,
        speed: 0.55,
        useNativeDriver: false,
      }),
      Animated.spring(rotate, {
        toValue: parseFloat(shape.rotate),
        bounciness: 7,
        speed: 0.55,
        useNativeDriver: true,
      }),
    ]).start();
  }, [shapeIndex, radius, rotate]);

  return (
    <View style={styles.badgeWrapper}>
      <BouncyPressable onPress={() => setShapeIndex((i) => (i + 1) % BADGE_SHAPES.length)}>
        <View
          style={[
            styles.badgeBody,
            {
              width: BADGE_SIZE,
              height: BADGE_SIZE,
              borderRadius: radius,
              backgroundColor: tintColor,
              transform: [
                { rotate: rotate.interpolate({ inputRange: [-10, 10], outputRange: ['-10deg', '10deg'] }) },
              ],
            },
          ]}
        >
          <Text style={styles.badgeEmoji}>{emoji}</Text>
        </View>
      </BouncyPressable>
      {label ? <Text style={styles.badgeLabel}>{label}</Text> : null}
    </View>
  );
}

/* -------------------------------- Styles --------------------------------- */

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  omDigit: {
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    marginHorizontal: 1,
  },
  ringCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringValue: { fontSize: 24, fontWeight: '800' },
  ringCaption: { fontSize: 11, fontWeight: '600', letterSpacing: 1 },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: BAR_MAX_HEIGHT + 34,
  },
  dayColumn: { flex: 1, alignItems: 'center' },
  barArea: {
    width: '70%',
    height: BAR_MAX_HEIGHT + 14,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: { width: '100%', borderRadius: 12, maxHeight: '100%' },
  seal: {
    position: 'absolute',
    top: -8,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sealText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  barLabel: { marginTop: 6, fontSize: 11, fontWeight: '600' },
  badgeWrapper: { alignItems: 'center', width: 72 },
  badgeBody: { alignItems: 'center', justifyContent: 'center' },
  badgeEmoji: { fontSize: 24 },
  badgeLabel: { marginTop: 4, fontSize: 11, fontWeight: '600', opacity: 0.6 },
});
