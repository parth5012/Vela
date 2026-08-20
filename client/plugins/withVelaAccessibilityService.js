const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function withVelaAccessibilityService(config) {
  // 1. Modify AndroidManifest.xml: inject BIND_ACCESSIBILITY_SERVICE permission and service declaration
  config = withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const mainManifest = androidManifest.manifest;

    // Ensure uses-permission array exists
    if (!mainManifest['uses-permission']) {
      mainManifest['uses-permission'] = [];
    }

    const permissionName = 'android.permission.BIND_ACCESSIBILITY_SERVICE';
    const hasPermission = mainManifest['uses-permission'].some(
      (p) => p.$?.['android:name'] === permissionName
    );

    if (!hasPermission) {
      mainManifest['uses-permission'].push({
        $: { 'android:name': permissionName },
      });
    }

    // Add FOREGROUND_SERVICE permissions
    const foregroundPermissions = [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
    ];
    for (const fp of foregroundPermissions) {
      const hasFp = mainManifest['uses-permission'].some(
        (p) => p.$?.['android:name'] === fp
      );
      if (!hasFp) {
        mainManifest['uses-permission'].push({
          $: { 'android:name': fp },
        });
      }
    }

    // Add VelaAccessibilityService declaration to the application tag (as a service element)
    const appElement = mainManifest['application']?.[0] || {};
    if (!appElement['service']) {
      appElement['service'] = [];
    }

    const serviceExists = appElement['service'].some(
      (srv) => srv.$?.['android:name'] === '.VelaAccessibilityService'
    );

    if (!serviceExists) {
      const serviceTag = {
        $: {
          'android:name': '.VelaAccessibilityService',
          'android:exported': 'true',
          'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.accessibilityservice.AccessibilityService',
                },
              },
            ],
          },
        ],
      };
      appElement['service'].push(serviceTag);
    }

    return config;
  });

  // 2. Modify settings.gradle to include device-agent module using dangerous mod
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const settingsGradlePath = path.join(config.modRequest.platformProjectRoot, 'settings.gradle');
      let content = fs.readFileSync(settingsGradlePath, 'utf8');
      if (!content.includes("include ':device-agent'")) {
        content = content.replace(
          "include ':stable-diffusion'",
          "include ':device-agent'\nproject(':device-agent').projectDir = new File(settingsDir, '../modules/device-agent/android')\ninclude ':stable-diffusion'"
        );
      }
      fs.writeFileSync(settingsGradlePath, content);
      return config;
    },
  ]);

  return config;
}

module.exports = withVelaAccessibilityService;
