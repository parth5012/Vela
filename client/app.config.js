import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const IS_PROD = process.env.APP_VARIANT === 'production';

// EAS Build only uploads git-tracked files (google-services.json is gitignored).
// Don't hard-fail prebuild when the file is missing on CI - Firebase will be
// unavailable but the build succeeds. Provide the file via EAS secret
// GOOGLE_SERVICES_JSON or commit it if you need FCM.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const googleServicesFilePath = './google-services.json';
const hasGoogleServicesFile = fs.existsSync(path.join(__dirname, googleServicesFilePath));

export default {
  "expo": {
    "name": IS_PROD ? "Vela - Your Personal Assistant" : "Vela (Dev)",
    "slug": "client",
    "scheme": "vela-client",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "light",
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": IS_PROD ? "com.parth5012.client" : "com.parth5012.client.dev",
      "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false
      }
    },
    "android": {
      "adaptiveIcon": {
        "backgroundColor": "#E6F4FE",
        "foregroundImage": "./assets/android-icon-foreground.png",
        "backgroundImage": "./assets/android-icon-background.png",
        "monochromeImage": "./assets/android-icon-monochrome.png"
      },
      "predictiveBackGestureEnabled": false,
      "package": IS_PROD ? "com.parth5012.client" : "com.parth5012.client.dev",
      ...(hasGoogleServicesFile ? { "googleServicesFile": googleServicesFilePath } : {}),
      "softwareKeyboardLayoutMode": "adjustResize"
    },
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "plugins": [
      "expo-router",
      "expo-sharing",
      "./plugins/withAbiSplits",
      "./plugins/withVelaAccessibilityService",
      [
        "expo-notifications",
        {
          "icon": "./assets/splash-icon.png",
          "color": "#ffffff"
        }
      ]
    ],
    "extra": {
      "router": {},
      "eas": {
        "projectId": "5a7e1fb7-9a26-423b-9467-7dc6c0498693"
      }
    }
  }
};
