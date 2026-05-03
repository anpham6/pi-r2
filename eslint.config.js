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
    {
        files: [
            'src/cloud/minio/**/*.ts'
        ],
        rules: {
            '@typescript-eslint/no-confusing-void-expression': 'off'
        }
    },
    {
        files: [
            'src/document/csso/index.ts'
        ],
        rules: {
            '@typescript-eslint/no-base-to-string': 'off'
        }
    }
);