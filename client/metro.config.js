const path = require('path');
const fs = require('fs');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push('sql');

// Web preview and E2E: serve wasm assets with correct application/wasm MIME type
const prevEnhanceMiddleware = config.server?.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const next = prevEnhanceMiddleware ? prevEnhanceMiddleware(middleware, server) : middleware;
    return (req, res, nextMiddleware) => {
      if (req.url && (req.url.endsWith('.wasm') || req.url.includes('.wasm?'))) {
        const urlBase = req.url.split('?')[0].replace(/^\//, '');
        const baseName = path.basename(urlBase);
        const candidates = [
          path.join(__dirname, 'public', baseName),
          path.join(__dirname, 'node_modules', 'sql.js', 'dist', baseName),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            res.setHeader('Content-Type', 'application/wasm');
            res.end(fs.readFileSync(candidate));
            return;
          }
        }
      }
      return next(req, res, nextMiddleware);
    };
  },
};

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
  if (platform === 'web' && moduleName === 'expo-sqlite') {
    return {
      type: 'sourceFile',
      filePath: path.join(__dirname, 'stubs', 'expo-sqlite.web.ts'),
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
