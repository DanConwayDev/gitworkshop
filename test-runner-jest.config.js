const { getJestConfig } = require('@storybook/test-runner');
const path = require('path');
/**
 * @type {import('@jest/types').Config.InitialOptions}
 */
module.exports = {
  // The default configuration comes from @storybook/test-runner
  ...getJestConfig(),
  /** Add your own overrides below
   * @see https://jestjs.io/docs/configuration
   */
  snapshotResolver: "<rootDir>/test-runner-snapshotresolver.js"
};
