import type { ITransformSeries } from '@e-mc/types/lib/document';

import type * as uglify from 'uglify-js';

import { isObject, removeInternalProperties } from '@e-mc/document/util';

const MINIFY_PROPS = [
    'annotations',
    'compress',
    'enclose',
    'ie',
    'ie8',
    'keep_fnames',
    'mangle',
    'nameCache',
    'output',
    'parse',
    'rename',
    'sourceMap',
    'timings',
    'toplevel',
    'v8',
    'validate',
    'warnings',
    'webkit',
    'wrap'
];

export default function transform(context: typeof uglify, value: string, options: ITransformSeries<uglify.MinifyOptions>) {
    const { sourceMap, supplementChunks } = options;
    const baseConfig = options.toBaseConfig();
    let url: string | undefined;
    if (baseConfig.sourceMap === false) {
        sourceMap.reset();
    }
    else if (isObject(baseConfig.sourceMap) || sourceMap.map && (baseConfig.sourceMap = {})) {
        const map = baseConfig.sourceMap as PlainObject;
        if (sourceMap.map) {
            map.content = sourceMap.map;
        }
        map.asObject = true;
        if (map.url !== 'inline') {
            url = map.url as string | undefined;
        }
    }
    for (const chunk of supplementChunks) {
        const chunkConfig = { ...baseConfig };
        if (isObject(chunkConfig.sourceMap)) {
            chunkConfig.sourceMap = { content: chunk.sourceMap?.map, asObject: true } as uglify.SourceMapOptions;
        }
        const result = context.minify(chunk.code, chunkConfig);
        if (result) {
            const { code, map } = result;
            chunk.code = code;
            if (map) {
                (chunk.sourceMap ||= options.createSourceMap(code)).nextMap('uglify-js', code, map);
            }
            else {
                chunk.sourceMap?.reset();
            }
        }
    }
    const result = context.minify(value, removeInternalProperties(baseConfig, MINIFY_PROPS));
    if (result) {
        if (result.map) {
            sourceMap.nextMap('uglify-js', result.code, result.map, url);
        }
        return result.code;
    }
}