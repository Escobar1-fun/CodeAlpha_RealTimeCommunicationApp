import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from './theme';

const VARIANTS = {
  default: { backgroundColor: colors.raised, borderColor: colors.line },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  ghost: { backgroundColor: 'transparent', borderColor: colors.line },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
};

/** Full-screen container that keeps content clear of the status and navigation bars. */
export function Screen({ style, children }) {
  const insets = useSafeAreaInsets();
  const { padding = 0 } = StyleSheet.flatten(style) ?? {};
  return (
    <View
      style={[
        style,
        {
          paddingTop: padding + insets.top,
          paddingBottom: padding + insets.bottom,
          paddingLeft: padding + insets.left,
          paddingRight: padding + insets.right,
        },
      ]}
    >
      {children}
    </View>
  );
}

export function Button({ label, onPress, variant = 'default', disabled, icon, small }) {
  const color = variant === 'primary' ? colors.onAccent : variant === 'danger' ? '#fff' : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        VARIANTS[variant],
        small && styles.small,
        (pressed || disabled) && styles.dim,
      ]}
    >
      {icon}
      <Text style={[styles.buttonText, small && styles.smallText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function RoundButton({ icon, onPress, label, state, disabled, badge, size = 46 }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), selected: state === 'on' }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.round,
        { width: size, height: size, borderRadius: size / 2 },
        state === 'off' && styles.off,
        state === 'on' && styles.on,
        (pressed || disabled) && styles.dim,
      ]}
    >
      {icon}
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function iconColor(state) {
  if (state === 'on') return colors.onAccent;
  if (state === 'off') return '#fff';
  return colors.text;
}

export function Wordmark() {
  return (
    <View style={styles.wordmark}>
      <View style={styles.ring} />
      <Text style={styles.wordmarkText}>Roundtable</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 8,
  },
  small: { minHeight: 36, paddingHorizontal: 10 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  smallText: { fontSize: 13 },
  dim: { opacity: 0.55 },
  round: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
  },
  off: { backgroundColor: colors.danger, borderColor: colors.danger },
  on: { backgroundColor: colors.accent, borderColor: colors.accent },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  badgeText: { color: colors.onAccent, fontSize: 12, fontWeight: '700' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ring: { width: 12, height: 12, borderWidth: 3, borderColor: colors.accent, borderRadius: 6 },
  wordmarkText: { color: colors.text, fontSize: 18, fontWeight: '700' },
});
