import { Share } from 'react-native';

export async function shareText(message: string, title?: string) {
  try {
    const result = await Share.share({ message, title });
    return result;
  } catch {
    return { action: Share.dismissedAction };
  }
}

export async function shareUrl(url: string, title?: string, message?: string) {
  return shareText(`${message ? `${message}\n\n` : ''}${url}`, title);
}
