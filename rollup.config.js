module.exports = [
    './publish/ibm/client/index.js',
    './publish/minio/client/index.js',
    './publish/minio/download/index.js',
    './publish/minio/upload/index.js',
    './publish/redis/client/index.js',
    './publish/jimp/index.js',
    './publish/jimp/util.js',
    './publish/jimp/worker/jimp.js'
].map(file => {
    return {
        input: file,
        treeshake: false,
        output: { file, format: 'commonjs' }
    };
});