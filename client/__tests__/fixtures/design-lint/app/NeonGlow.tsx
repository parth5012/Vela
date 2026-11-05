import { StyleSheet, Text } from 'react-native';

// Design-lint fixture: a neon text glow is an error; a faint desaturated
// text shadow is not.
export function Neon() {
  return <Text style={styles.neon}>glow</Text>;
}

const styles = StyleSheet.create({
  neon: {
    textShadowRadius: 12,
    textShadowColor: '#00FF88',
  },
  subtle: {
    textShadowRadius: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
  },
});
