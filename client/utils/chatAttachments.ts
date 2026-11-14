import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';
import type { ChatAttachment } from '../store/useChatStore';
import { compressImage, CompressedImageResult, ALLOWED_MIME_TYPES } from './imageCompression';

export interface PickedImageFile {
  uri: string;
  name: string;
  size?: number;
  mimeType: string;
  compressed?: CompressedImageResult;
  altText?: string;
}

const normalizeUrl = (rawUrl: string): string => {
  let formattedUrl = (rawUrl || '').trim();
  if (!formattedUrl) return '';
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = 'https://' + formattedUrl;
  }
  return formattedUrl.replace(/\/+$/, '');
};

/**
 * Opens system document/image picker to select images with constraints:
 * - Allowed types: JPEG, PNG, WebP.
 * - Maximum count bounded by maxCount.
 */
export async function pickChatImages(maxCount: number = 2): Promise<PickedImageFile[]> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: ALLOWED_MIME_TYPES,
      multiple: true,
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return [];
    }

    const selectedAssets = result.assets.slice(0, maxCount);
    const files: PickedImageFile[] = [];

    for (const asset of selectedAssets) {
      const mime = (asset.mimeType || 'image/jpeg').toLowerCase();
      // Ensure only allowed types
      const effectiveMime = ALLOWED_MIME_TYPES.includes(mime) ? mime : 'image/jpeg';
      const name = asset.name || `image_${Date.now()}.jpg`;

      // Pre-compress asset according to Decision 4 & 5
      const compressed = await compressImage(asset.uri, undefined, undefined, effectiveMime);

      files.push({
        uri: asset.uri,
        name,
        size: compressed.size || asset.size,
        mimeType: effectiveMime,
        compressed,
      });
    }

    return files;
  } catch (error) {
    console.error('[pickChatImages] Error selecting images:', error);
    return [];
  }
}

/**
 * Uploads a single compressed image attachment to the backend POST /chat/attachments.
 */
export async function uploadChatAttachment(params: {
  apiUrl: string;
  apiKey: string;
  threadId: string;
  messageId: string;
  fileUri: string;
  mimeType: string;
  filename?: string;
  altText?: string;
  width?: number;
  height?: number;
}): Promise<ChatAttachment> {
  const { apiUrl, apiKey, threadId, messageId, fileUri, mimeType, filename, altText } = params;
  const baseUrl = normalizeUrl(apiUrl);
  if (!baseUrl) {
    throw new Error('API URL is not configured.');
  }

  const formData = new FormData();
  formData.append('thread_id', threadId);
  formData.append('message_id', messageId);
  if (altText && altText.trim()) {
    formData.append('alt_text', altText.trim());
  }

  const safeFilename = filename || `attachment_${Date.now()}.jpg`;

  if (Platform.OS === 'web' || typeof window !== 'undefined' && fileUri.startsWith('data:')) {
    // Convert base64 data URI or blob URI to Blob
    const response = await fetch(fileUri);
    const blob = await response.blob();
    formData.append('file', blob, safeFilename);
  } else {
    // Native React Native FormData entry
    formData.append('file', {
      uri: fileUri,
      name: safeFilename,
      type: mimeType || 'image/jpeg',
    } as any);
  }

  const res = await fetch(`${baseUrl}/chat/attachments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`Upload failed (${res.status}): ${errorBody || res.statusText}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    storage_path: data.storage_path,
    mime_type: data.mime_type || mimeType,
    file_size: data.file_size ?? data.size_bytes ?? 0,
    width: data.width || params.width,
    height: data.height || params.height,
    alt_text: data.alt_text || altText,
    url: data.url || fileUri,
  };
}

/**
 * Fetches a signed URL for a given storage path from GET /chat/attachments/signed-url.
 */
export async function fetchAttachmentSignedUrl(
  apiUrl: string,
  apiKey: string,
  storagePath: string
): Promise<string> {
  const baseUrl = normalizeUrl(apiUrl);
  if (!baseUrl) {
    throw new Error('API URL is not configured.');
  }

  const res = await fetch(
    `${baseUrl}/chat/attachments/signed-url?path=${encodeURIComponent(storagePath)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Failed to fetch signed URL (${res.status}): ${errorText}`);
  }

  const json = await res.json();
  return json.url;
}
