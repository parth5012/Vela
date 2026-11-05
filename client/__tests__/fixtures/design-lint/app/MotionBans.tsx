import { Easing } from 'react-native';

// Design-lint fixture: banned acceleration curves and catch-all transitions.
export const curve = Easing.in(Easing.quad);
export const inOutCurve = Easing.inOut(Easing.quad);
export const cssEasing = 'ease-in';
export const webTransition = { transition: 'all 200ms' };
