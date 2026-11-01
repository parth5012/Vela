/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-components-to-app',
      severity: 'error',
      comment: 'Components must not depend on app routes',
      from: { path: '^components' },
      to: { path: '^app' },
    },
    {
      name: 'no-components-to-db',
      severity: 'error',
      comment: 'Components must not access database directly (use stores/hooks)',
      from: { path: '^components' },
      to: { path: '^db' },
    },
    {
      name: 'no-store-to-components',
      severity: 'error',
      comment: 'Stores must not depend on UI components',
      from: { path: '^store' },
      to: { path: '^components' },
    },
    {
      name: 'no-store-to-app',
      severity: 'error',
      comment: 'Stores must not depend on app routes',
      from: { path: '^store' },
      to: { path: '^app' },
    },
    {
      name: 'no-utils-to-components',
      severity: 'error',
      comment: 'Utilities must not depend on UI components',
      from: { path: '^utils' },
      to: { path: '^components' },
    },
    {
      name: 'no-utils-to-app',
      severity: 'error',
      comment: 'Utilities must not depend on app routes',
      from: { path: '^utils' },
      to: { path: '^app' },
    },
    {
      name: 'no-types-to-components',
      severity: 'error',
      comment: 'Types must not depend on UI components',
      from: { path: '^types' },
      to: { path: '^components' },
    },
    {
      name: 'no-types-to-app',
      severity: 'error',
      comment: 'Types must not depend on app routes',
      from: { path: '^types' },
      to: { path: '^app' },
    },
    {
      name: 'no-types-to-store',
      severity: 'error',
      comment: 'Types must not depend on stores',
      from: { path: '^types' },
      to: { path: '^store' },
    },
    {
      name: 'no-modules-to-components',
      severity: 'error',
      comment: 'Native modules must not depend on UI components',
      from: { path: '^modules' },
      to: { path: '^components' },
    },
    {
      name: 'no-modules-to-app',
      severity: 'error',
      comment: 'Native modules must not depend on app routes',
      from: { path: '^modules' },
      to: { path: '^app' },
    },
    {
      name: 'no-client-to-backend',
      severity: 'error',
      comment: 'Client code must never import backend source files',
      from: { path: '.*' },
      to: { path: '.*backend.*' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
  },
};
