export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },
  testPathIgnorePatterns: ["/node_modules/", "/tests/helpers/"],
  testRegex: '(/tests/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
}
