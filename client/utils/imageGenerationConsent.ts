import AsyncStorage from '@react-native-async-storage/async-storage';

export const SD_CONSENT_DONT_ASK_AGAIN_KEY = 'sd_consent_dont_ask_again';

/**
 * Checks whether the user should be prompted for on-device generation consent.
 * Decision #11 & Decision 3 from #566:
 * Confirm on first use and when steps > 25 or battery < 20%, even if "Don't ask again" was set.
 */
export async function shouldPromptImageConsent(
  steps: number = 20,
  batteryLevel?: number
): Promise<boolean> {
  try {
    // If steps > 25 or low battery (< 20%), always re-prompt
    if (steps > 25) return true;
    if (batteryLevel !== undefined && batteryLevel < 0.2) return true;

    const dontAskAgain = await AsyncStorage.getItem(SD_CONSENT_DONT_ASK_AGAIN_KEY);
    return dontAskAgain !== 'true';
  } catch {
    return true;
  }
}

export async function setConsentDontAskAgain(dontAsk: boolean): Promise<void> {
  try {
    if (dontAsk) {
      await AsyncStorage.setItem(SD_CONSENT_DONT_ASK_AGAIN_KEY, 'true');
    } else {
      await AsyncStorage.removeItem(SD_CONSENT_DONT_ASK_AGAIN_KEY);
    }
  } catch {
    // Safe to ignore storage write error
  }
}
