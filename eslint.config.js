const sqd = require('sqd-eslint');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
    {
        ignores: [
            'build/',
            'publish/**/*.js'
        ]
    },
    ...sqd.configs.base,
    ...sqd.configs.nodejs,
    ...sqd.configs['pi-r'],
    ...sqd.configs.imports,
    {
        files: ['**/*.ts'],
        rules: {
            'import/no-duplicates': 'off',
        }
    }
);