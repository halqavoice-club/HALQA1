import * as Linking from 'expo-linking';
import { createDeepLink } from '../app/_layout';

export const deepLinkPrefixes = [
  Linking.createURL('/'),
  'halqa://',
  'https://halqa.app',
];

export function buildDeepLink(path: string) {
  return createDeepLink(path);
}
