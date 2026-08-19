import { useConfigStore, PermissionTier, DeviceAgentPermissions } from '../store/useConfigStore';
import { useSafetyStore } from '../store/useSafetyStore';

/**
 * Classifies a specific device agent action into one of the 20 permission categories.
 */
export function classifyAction(
  toolName: string,
  target?: string,
  value?: string
): keyof DeviceAgentPermissions {
  const targetLower = target ? target.toLowerCase() : '';
  const valueLower = value ? value.toLowerCase() : '';

  // 1. Check High Risk / Deny categories first
  if (targetLower.includes('root') || targetLower.includes('shizuku') || targetLower.includes('magisk') || targetLower.includes('superuser')) {
    return 'root_shizuku';
  }
  if (
    targetLower.includes('accessibility') ||
    targetLower.includes('permission') ||
    targetLower.includes('grant') ||
    targetLower.includes('allow access')
  ) {
    return 'permission_toggles';
  }
  if (
    targetLower.includes('sideload') ||
    targetLower.includes('install apk') ||
    targetLower.includes('unknown source') ||
    targetLower.includes('package installer')
  ) {
    return 'sideloads';
  }
  if (
    targetLower.includes('password') ||
    targetLower.includes('otp') ||
    targetLower.includes('pin') ||
    targetLower.includes('credentials') ||
    targetLower.includes('verification code') ||
    valueLower.includes('password') ||
    valueLower.includes('otp') ||
    valueLower.includes('pin')
  ) {
    return 'passwords_otps';
  }

  // 2. Check Medium Risk / Confirm categories next
  if (
    (toolName === 'device_open_app' && (targetLower.includes('play store') || targetLower.includes('google play'))) ||
    targetLower.includes('play store') ||
    targetLower.includes('google play')
  ) {
    return 'play_installs';
  }
  if (
    (toolName === 'device_open_app' && (targetLower.includes('settings') || targetLower.includes('config'))) ||
    targetLower.includes('system settings') ||
    targetLower.includes('developer options') ||
    targetLower.includes('configure')
  ) {
    return 'settings_changes';
  }
  if (
    targetLower.includes('delete') ||
    targetLower.includes('erase') ||
    targetLower.includes('wipe') ||
    targetLower.includes('remove') ||
    targetLower.includes('clear')
  ) {
    return 'deletions';
  }
  if (
    targetLower.includes('buy') ||
    targetLower.includes('pay') ||
    targetLower.includes('purchase') ||
    targetLower.includes('checkout') ||
    targetLower.includes('subscribe') ||
    targetLower.includes('premium')
  ) {
    return 'purchases';
  }
  if (
    targetLower.includes('send') ||
    targetLower.includes('sms') ||
    targetLower.includes('whatsapp') ||
    targetLower.includes('email') ||
    targetLower.includes('message')
  ) {
    return 'send_communication';
  }
  if (targetLower.includes('call') || targetLower.includes('dial') || targetLower.includes('phone')) {
    return 'calls';
  }

  // 3. Fallback to base action types
  if (toolName === 'device_screen_read') return 'screen_read';
  if (toolName === 'device_info') return 'info';
  if (toolName === 'device_screenshot') return 'screenshot';
  if (toolName === 'device_open_app') return 'open_app';
  if (toolName === 'device_scroll') return 'scroll';
  if (toolName === 'device_swipe') return 'swipe';
  if (toolName === 'device_press_key') return 'press_key';
  if (toolName === 'device_set_volume') return 'set_volume';
  if (toolName === 'device_type') return 'type';
  if (toolName === 'device_tap') return 'tap';

  return 'tap'; // Default fallback
}

/**
 * Gets the display label for a category.
 */
export function getCategoryLabel(category: keyof DeviceAgentPermissions): string {
  switch (category) {
    case 'screen_read': return 'Read Screen Content';
    case 'info': return 'Device Information';
    case 'screenshot': return 'Take Screenshot';
    case 'open_app': return 'Open Application';
    case 'scroll': return 'Scroll Screen';
    case 'swipe': return 'Swipe Screen';
    case 'press_key': return 'Press Hardware Key';
    case 'set_volume': return 'Set Volume';
    case 'type': return 'Type Text';
    case 'tap': return 'Tap Screen';
    case 'send_communication': return 'Send Communications';
    case 'calls': return 'Make Phone Calls';
    case 'purchases': return 'Perform Purchases';
    case 'deletions': return 'Perform Deletions';
    case 'settings_changes': return 'Modify System Settings';
    case 'play_installs': return 'Install from Play Store';
    case 'passwords_otps': return 'Passwords & OTPs';
    case 'sideloads': return 'Sideload Applications';
    case 'permission_toggles': return 'Toggle Permission Settings';
    case 'root_shizuku': return 'Root & Shizuku Operations';
    default: return String(category);
  }
}

/**
 * Evaluates safety approval for a device agent action based on active permission configuration
 * and sensitive word overrides.
 */
export async function evaluateSafety(
  toolName: string,
  target?: string,
  value?: string,
  thoughts?: string,
  conversationId: string = 'global',
  taskToken?: string
): Promise<{ status: 'success' | 'error'; result: string }> {
  const permissions = useConfigStore.getState().deviceAgentPermissions;
  const category = classifyAction(toolName, target, value);
  let tier = permissions[category] || 'auto';

  // Heuristic sensitive word pattern check
  // If action is configured as Auto but hits sensitive keywords, upgrade tier to Ask/Confirm
  if (tier === 'auto') {
    const targetLower = target ? target.toLowerCase() : '';
    const valueLower = value ? value.toLowerCase() : '';
    const sensitiveWords = ['delete', 'buy', 'pay', 'purchase', 'send', 'call', 'remove', 'clear'];
    const hasSensitiveWord = sensitiveWords.some(word => targetLower.includes(word) || valueLower.includes(word));
    
    if (hasSensitiveWord) {
      tier = 'confirm';
    }
  }

  // Deny path: Return immediately containing clear user policy block reason
  if (tier === 'deny') {
    return {
      status: 'error',
      result: `Blocked by user policy: Action category "${getCategoryLabel(category)}" is set to Blocked (Deny).`
    };
  }

  // Confirm path: Trigger global async modal check
  if (tier === 'confirm') {
    try {
      const response = await useSafetyStore.getState().requestApproval({
        toolName,
        target,
        value,
        thoughts,
        conversationId,
        taskToken,
      });
      return response;
    } catch (e: any) {
      return {
        status: 'error',
        result: `Safety evaluation failed: ${e?.message || e}`
      };
    }
  }

  // Auto path: return success directly to allow native invocation
  return {
    status: 'success',
    result: 'Allowed automatically'
  };
}
