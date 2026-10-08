/**
 * Module: client/hooks/useMessageActions
 * Intent: Chat message menu actions extracted verbatim from app/index.tsx — copy, share,
 *   download-as-markdown, copy-code-blocks, show response metadata.
 * Public API: useMessageActions() → { handleCopyText, handleShareText, handleDownloadMd,
 *   handleCopyCodeBlocks, handleShowInfo }.
 * Invariants: Handlers keep their original useCallback dependency sets; config values are
 *   selected from useConfigStore inside the hook (same sources the screen reads).
 * Side Effects: clipboard writes, OS share sheets, cache-directory file write.
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { useCallback } from 'react';
import { Alert, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useConfigStore } from '../store/useConfigStore';
import type { Message } from '../store/useChatStore';

export function useMessageActions() {
  const modelName = useConfigStore((state) => state.modelName);
  const connectionMode = useConfigStore((state) => state.connectionMode);
  const isLocalMode = connectionMode === 'local';
  const localModelName = useConfigStore((state) => state.localModelName);

  const handleCopyText = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Success', 'Copied to clipboard');
  }, []);

  const handleShareText = useCallback(async (text: string) => {
    try {
      await Share.share({ message: text });
    } catch (err: any) {
      console.error(err);
    }
  }, []);

  const handleDownloadMd = useCallback(async (message: Message) => {
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `vela-response-${message.id}-${dateStr}.md`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;
      const mdContent = `# Vela Agent Response\n*Date: ${new Date().toLocaleString()}*\n\n${message.content}`;

      await FileSystem.writeAsStringAsync(fileUri, mdContent, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(fileUri, { mimeType: 'text/markdown', dialogTitle: 'Download Response' });
    } catch (err: any) {
      Alert.alert('Error', 'Failed to save markdown file.');
    }
  }, []);

  const handleCopyCodeBlocks = useCallback(async (text: string) => {
    const codeBlockRegex = /```[\s\S]*?```/g;
    const matches = text.match(codeBlockRegex);
    if (!matches || matches.length === 0) {
      Alert.alert('Info', 'No code blocks found in message.');
      return;
    }

    const cleanedCodes = matches.map((m) => {
      return m.replace(/^```[a-zA-Z0-9+#-]*\n/, '').replace(/```$/, '');
    }).join('\n\n---\n\n');

    await Clipboard.setStringAsync(cleanedCodes);
    Alert.alert('Success', 'Copied code blocks to clipboard.');
  }, []);

  const handleShowInfo = useCallback((message: Message) => {
    const wordCount = message.content.trim().split(/\s+/).filter(Boolean).length;
    const charCount = message.content.length;
    Alert.alert(
      'Response Metadata',
      `Model: ${isLocalMode ? `Local (${localModelName})` : (modelName || 'gemini-1.5-flash')}\nWords: ${wordCount}\nCharacters: ${charCount}`
    );
  }, [modelName, isLocalMode, localModelName]);

  return { handleCopyText, handleShareText, handleDownloadMd, handleCopyCodeBlocks, handleShowInfo };
}

export default useMessageActions;
