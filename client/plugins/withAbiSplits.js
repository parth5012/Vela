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
  '            universalApk = false',
  '        }',
  '    }',
].join('\n');

function addSplitsBlock(contents) {
  if (/splits\s*\{/.test(contents)) {
    return contents;
  }
  const match = contents.match(/^(\s*)android\s*\{/m);
  if (!match) {
    return contents;
  }
  const indent = match[1];
  const block = SPLITS_BLOCK
    .split('\n')
    .map((line) => (line.trim() ? indent + line : line))
    .join('\n');
  return contents.replace(match[0], match[0] + '\n' + block);
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
