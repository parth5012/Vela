import { Stack } from 'expo-router';

// Settings is a native stack: the index lists categories and each group is a
// pushed screen. The drawer header ("Settings") stays visible; each screen
// draws its own in-body back row so the stack feels like sub-navigation.
export default function SettingsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
