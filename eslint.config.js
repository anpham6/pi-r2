import { defineConfig, globalIgnores } from 'eslint/config';

import * as sqd from 'sqd-eslint';

export default defineConfig(
    globalIgnores([
        'build/',
        'publish/**/*.js'
    ]),
    ...sqd.configs.base,
    ...sqd.configs.nodejs,
    ...sqd.configs['pi-r'],
    ...sqd.configs.imports,
    {
        files: ['**/*.ts'],
        rules: {
            'import/no-duplicates': 'off',
        }
    },
    {
        files: ['src/compress/imagemin/*.ts'],
        rules: {
            'import/no-unresolved': 'off',
        }
    },
    {
        files: ['src/cloud/minio/**/*.ts'],
        rules: {
            '@typescript-eslint/no-confusing-void-expression': 'off'
        }
    }
);