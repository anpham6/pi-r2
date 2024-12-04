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
        input: './publish/jimp/util.js',
        treeshake: false,
        output: {
            file: './publish/jimp/util.js',
            format: 'commonjs'
        }
    }
];