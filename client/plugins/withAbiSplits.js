const {
  withAppBuildGradle,
  withGradleProperties,
} = require('@expo/config-plugins');

const ABI_INCLUDE = ['arm64-v8a', 'x86_64'];

const SPLITS_BLOCK = [
  '    splits {',
  '        abi {',
  '            enable = true',
  '            reset()',
  `            include ${ABI_INCLUDE.map((a) => JSON.stringify(a)).join(', ')}`,
  '            universalApk = false // keep false: universal is ~2x size; use per-ABI APKs (arm64 for phones, x86_64 for emulators) via scripts/install-apk.ps1',
  '        }',
  '    }',
  '    compileOptions {',
  '        coreLibraryDesugaringEnabled true',
  '    }',
].join('\n');

function addSplitsBlock(contents) {
  let updated = contents;
  if (!/splits\s*\{/.test(updated)) {
    const match = updated.match(/^(\s*)android\s*\{/m);
    if (match) {
      const indent = match[1];
      const block = SPLITS_BLOCK
        .split('\n')
        .map((line) => (line.trim() ? indent + line : line))
        .join('\n');
      updated = updated.replace(match[0], match[0] + '\n' + block);
    }
  } else if (!/coreLibraryDesugaringEnabled/.test(updated)) {
    updated = updated.replace(
      /android\s*\{/,
      'android {\n    compileOptions {\n        coreLibraryDesugaringEnabled true\n    }'
    );
  }

  if (!/coreLibraryDesugaring\b/.test(updated)) {
    updated = updated.replace(
      /dependencies\s*\{/,
      'dependencies {\n    coreLibraryDesugaring "com.android.tools:desugar_jdk_libs:2.1.4"'
    );
  }

  return updated;
}

function upsertProperty(entries, key, value) {
  const list = Array.isArray(entries) ? entries : entries.properties || [];
  const existing = list.find((p) => p && p.type === 'property' && p.key === key);
  if (existing) {
    existing.value = value;
  } else {
    list.push({ type: 'property', key, value });
  }
  return list;
}

module.exports = withAbiSplits;
module.exports.default = withAbiSplits;
module.exports.addSplitsBlock = addSplitsBlock;

function withAbiSplits(config) {
  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = addSplitsBlock(config.modResults.contents);
    return config;
  });

  config = withGradleProperties(config, (config) => {
    const entries = Array.isArray(config.modResults)
      ? config.modResults
      : config.modResults.properties;
    upsertProperty(entries, 'android.enableMinifyInReleaseBuilds', 'true');
    upsertProperty(entries, 'android.enableShrinkResourcesInReleaseBuilds', 'true');
    return config;
  });

  return config;
}
