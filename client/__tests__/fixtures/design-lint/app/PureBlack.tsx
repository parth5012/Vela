import { StyleSheet } from 'react-native';

// Design-lint fixture: pure black grounds and shadows are refuse-list errors.
// The tinted tokens below must stay clean.
export const badStyles = StyleSheet.create({
  card: {
    backgroundColor: '#000000',
    shadowColor: '#000',
  },
  tinted: {
    backgroundColor: '#050505',
    shadowColor: '#15121c',
  },
});
