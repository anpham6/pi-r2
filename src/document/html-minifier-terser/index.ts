import type { ITransformSeries } from '@e-mc/types/lib/document';

import type * as hmt from 'html-minifier-terser';

async function transform(context: typeof hmt, value: string, options: ITransformSeries<hmt.Options>) {
    return context.minify(value, options.toBaseConfig());
}

export = transform;