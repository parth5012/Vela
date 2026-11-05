import { Pressable, Text } from 'react-native';

// Design-lint fixture: copy-level warns — standalone emoji label, filler
// verbs, em dash in user-facing copy.
export function Copy() {
  return (
    <>
      <Pressable>
        <Text>🚀</Text>
      </Pressable>
      <Text>{'Elevate your workflow with our seamless AI'}</Text>
      <Text>{'Vela replies — fast'}</Text>
    </>
  );
}
