import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';

export interface SharedFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

/**
 * Open the document picker to select one or more files.
 * On Android this also handles incoming SEND intents when launched from share target.
 * On iOS this uses Files.app (iOS Share Extension is Phase 5).
 */
export async function pickDocument(): Promise<SharedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
  });

  if (result.canceled) return [];

  return result.assets.map(a => ({
    uri: a.uri,
    name: a.name,
    mimeType: a.mimeType ?? 'application/octet-stream',
    size: a.size,
  }));
}

/**
 * Share content from within the app (e.g., a briefing or listing report).
 * Falls back gracefully on platforms that don't support sharing.
 */
export async function shareContent(uri: string, dialogTitle?: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { dialogTitle });
  }
}
