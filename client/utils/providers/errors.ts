import { ProviderSlug } from '../../store/useConfigStore';

export type CloudErrorKind =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'model_not_found'
  | 'network'
  | 'unknown';

export class CloudProviderError extends Error {
  readonly kind: CloudErrorKind;
  readonly provider: ProviderSlug;
  readonly originalError?: any;

  constructor(
    kind: CloudErrorKind,
    message: string,
    provider: ProviderSlug,
    originalError?: any
  ) {
    super(message);
    this.name = 'CloudProviderError';
    this.kind = kind;
    this.provider = provider;
    this.originalError = originalError;
  }
}

export function classifyCloudError(error: any, provider: ProviderSlug): CloudProviderError {
  let rawMessage = error?.message || (typeof error === 'string' ? error : '');
  if (!rawMessage) {
    try {
      rawMessage = JSON.stringify(error || '');
    } catch {
      rawMessage = String(error || '');
    }
  }

  // Redact potential API keys / secrets in query strings or headers
  const message = rawMessage
    .replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/gi, '$1...');

  const status = error?.status || error?.statusCode || error?.response?.status;
  const lowerMsg = message.toLowerCase();

  let kind: CloudErrorKind = 'unknown';

  if (
    status === 401 ||
    status === 403 ||
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('invalid api key') ||
    lowerMsg.includes('incorrect api key') ||
    lowerMsg.includes('api_key_invalid') ||
    lowerMsg.includes('authentication')
  ) {
    kind = 'auth';
  } else if (
    (status === 429 &&
      (lowerMsg.includes('quota') || lowerMsg.includes('billing') || lowerMsg.includes('insufficient_quota'))) ||
    status === 402 ||
    lowerMsg.includes('quota exceeded') ||
    lowerMsg.includes('exceeded your current quota') ||
    lowerMsg.includes('credit balance') ||
    lowerMsg.includes('resource_exhausted') ||
    lowerMsg.includes('insufficient credits') ||
    lowerMsg.includes('payment required')
  ) {
    kind = 'quota';
  } else if (
    status === 429 ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('rate_limit') ||
    lowerMsg.includes('too many requests')
  ) {
    kind = 'rate_limit';
  } else if (
    status === 404 ||
    lowerMsg.includes('model not found') ||
    lowerMsg.includes('does not exist') ||
    lowerMsg.includes('not found') ||
    lowerMsg.includes('unsupported model')
  ) {
    kind = 'model_not_found';
  } else if (
    lowerMsg.includes('network') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('econnrefused')
  ) {
    kind = 'network';
  }

  return new CloudProviderError(kind, message, provider, error);
}
