import type { ITransformSeries } from '@e-mc/types/lib/document';

import type { Options } from 'html-minifier-terser';

import type hmt from 'html-minifier-terser';

async function transform(context: typeof hmt, value: string, options: ITransformSeries<Options>) {
    return context.minify(value, options.toBaseConfig());
}

export = transform;