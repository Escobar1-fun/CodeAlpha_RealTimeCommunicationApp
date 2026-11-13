import { NativeModules, Platform } from 'react-native';

// Expo Go doesn't contain WebRTC's native code, and requiring the library without it
// throws. Everything that isn't audio or video keeps working in that case.
export const noWebRTC = !NativeModules.WebRTCModule;

// iOS needs a separate broadcast extension, which this app doesn't include.
export const canShareScreen = !noWebRTC && Platform.OS === 'android';

export const rtc = noWebRTC ? null : require('react-native-webrtc');
export const InCallManager = noWebRTC ? null : require('react-native-incall-manager').default;
