import type { ITransformSeries, RawSourceMap } from '@e-mc/types/lib/document';

import type cc from 'clean-css';

export default function transform(context: typeof cc, value: string, options: ITransformSeries<cc.OptionsOutput>) {
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
    const result = new context(baseConfig).minify(value, map!);
    if (result) {
        if (result.sourceMap) {
            sourceMap.nextMap('clean-css', result.styles, result.sourceMap.toString());
        }
        return result.styles;
    }
}