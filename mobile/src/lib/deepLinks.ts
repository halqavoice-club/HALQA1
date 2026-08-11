import * as Linking from 'expo-linking';

export const deepLinkPrefixes = [
  Linking.createURL('/'),
  'halqa://',
  'https://halqa.app',
];

export function buildDeepLink(path: string) {
  return Linking.createURL(path);
}
