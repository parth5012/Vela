import { StyleSheet, View } from 'react-native';

// Design-lint fixture: a left accent bar wider than 1px on a card.
export function Bar() {
  return <View style={styles.bar} />;
}

const styles = StyleSheet.create({
  bar: {
    borderLeftWidth: 3,
    borderLeftColor: '#6D3AE8',
  },
});
