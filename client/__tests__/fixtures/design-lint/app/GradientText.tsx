// @ts-nocheck — the fixture references the masked-view package (not installed)
// deliberately: the lint scans identifiers, not module resolution.
import { Text } from 'react-native';
import MaskedView from '@react-native-community/masked-view';
import { LinearGradient } from 'expo-linear-gradient';

// Design-lint fixture: the masked-gradient fill recipe (gradient text).
export function GradientHeadline() {
  return (
    <MaskedView maskElement={<Text>headline</Text>}>
      <LinearGradient colors={['#6D3AE8', '#B69BF7']} />
    </MaskedView>
  );
}
