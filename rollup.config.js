export default [
    './publish/ibm/client/index.js',
    './publish/minio/client/index.js',
    './publish/minio/download/index.js',
    './publish/minio/upload/index.js'
].map(file => {
    return {
        input: file,
        treeshake: false,
        output: { file, format: 'commonjs' }
    };
});