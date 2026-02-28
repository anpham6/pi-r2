export default [
    './publish/clean-css/index.js',
    './publish/csso/index.js',
    './publish/html-minifier/index.js',
    './publish/html-minifier-terser/index.js',
    './publish/ibm/client/index.js',
    './publish/ibm/download/index.js',
    './publish/ibm/upload/index.js',
    './publish/minio/client/index.js',
    './publish/minio/download/index.js',
    './publish/minio/upload/index.js',
    './publish/svgo/index.js',
    './publish/uglify-js/index.js'
].map(file => {
    return {
        input: file,
        treeshake: false,
        output: { file, format: 'commonjs', strict: false }
    };
});