const { withAndroidBuildGradle, withAndroidGradleProperties } = require('@expo/config-plugins');

const ABI_INCLUDE = ['arm64-v8a', 'x86_64'];

const SPLITS_BLOCK = `
    splits {
        abi {
            enable = true
            reset()
            include ${ABI_INCLUDE.map((a) => JSON.stringify(a)).join(', ')}
            universalApk = false
        }
    }
`;

function addSplitsBlock(contents) {
  if (/splits\s*\{/.test(contents)) {
    return contents;
  }
  const match = contents.match(/^(\s*)android\s*\{/m);
  if (!match) {
    return contents;
  }
  const indent = match[1];
  const block = SPLITS_BLOCK.split('\n').join('\n' + indent);
  return contents.replace(match[0], match[0] + block.replace(/(\r?\n)\s*$/, '') + '\n' + indent);
}

module.exports = withAbiSplits;
module.exports.default = withAbiSplits;
module.exports.addSplitsBlock = addSplitsBlock;
function withAbiSplits(config) {
  config = withAndroidBuildGradle(config, (config) => {
    config.modResults.contents = addSplitsBlock(config.modResults.contents);
    return config;
  });

  config = withAndroidGradleProperties(config, (config) => {
    const { getAndroidGradleProperties } = require('@expo/config-plugins');
    const props = getAndroidGradleProperties(config.modResults);
    const updates = [
      ['android.enableMinifyInReleaseBuilds', 'true'],
      ['android.enableShrinkResourcesInReleaseBuilds', 'true'],
    ];
    updates.forEach(([key, value]) => {
      const existing = props.find((p) => p.type === 'property' && p.key === key);
      if (existing) {
        existing.value = value;
      } else {
        props.push({ type: 'property', key, value });
      }
    });
    return config;
  });

  return config;
};
