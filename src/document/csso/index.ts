import type { ITransformSeries, RawSourceMap } from '@e-mc/types/lib/document';

import type cs from 'csso';

import { SourceMapConsumer, type SourceMapGenerator } from 'source-map-js';

function transform(context: typeof cs, value: string, options: ITransformSeries<cs.MinifyOptions>) {
    context = options.upgrade(context, __dirname);
    const sourceMap = options.sourceMap;
    const baseConfig = options.toBaseConfig();
    let map: RawSourceMap<string> | undefined;
    if (baseConfig.sourceMap === false) {
        sourceMap.reset();
    }
    else if (map = sourceMap.map as RawSourceMap<string>) {
        baseConfig.sourceMap = true;
    }
    const result = context.minify(value, baseConfig);
    if (result) {
        if (result.map) {
            try {
                if (map) {
                    (result.map as SourceMapGenerator).applySourceMap(new SourceMapConsumer(map), baseConfig.filename || 'unknown');
                }
                sourceMap.nextMap('csso', result.css, result.map.toString(), baseConfig.filename); // eslint-disable-line @typescript-eslint/no-base-to-string
            }
            catch (err) {
                options.addLog(options.statusType.ERROR, err, { source: options.packageName });
                sourceMap.reset();
            }
        }
        return result.css;
    }
}

export = transform;