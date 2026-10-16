const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push('sql');

// Web preview only: `llama.rn` has no web build and throws at module init,
// which took down every route under `expo start --web`. The Android/iOS
// resolution path is unchanged (platform !== 'web' falls through to Metro).
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'llama.rn') {
    return {
      type: 'sourceFile',
      filePath: path.join(__dirname, 'stubs', 'llama-rn.web.ts'),
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
