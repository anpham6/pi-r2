module.exports = [
    {
        input: './publish/ibm/client/index.js',
        treeshake: false,
        output: {
            file: './publish/ibm/client/index.js',
            format: 'commonjs'
        }
    },
    {
        input: './publish/minio/client/index.js',
        treeshake: false,
        output: {
            file: './publish/minio/client/index.js',
            format: 'commonjs'
        }
    },
    {
        input: './publish/minio/download/index.js',
        treeshake: false,
        output: {
            file: './publish/minio/download/index.js',
            format: 'commonjs'
        }
    },
    {
        input: './publish/minio/upload/index.js',
        treeshake: false,
        output: {
            file: './publish/minio/upload/index.js',
            format: 'commonjs'
        }
    },
    {
        input: './publish/svgo/index.js',
        treeshake: false,
        output: {
            file: './publish/svgo/index.js',
            format: 'commonjs'
        }
    },
    {
        input: './publish/uglify-js/index.js',
        treeshake: false,
        output: {
            file: './publish/uglify-js/index.js',
            format: 'commonjs'
        }
    },
    {
        input: './publish/jimp/util.js',
        treeshake: false,
        output: {
            file: './publish/jimp/util.js',
            format: 'commonjs'
        }
    }
];