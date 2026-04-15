import type { ITransformSeries } from '@e-mc/types/lib/document';

import type * as hm from 'html-minifier-next';

export default async function transform(context: typeof hm, value: string, options: ITransformSeries<hm.MinifierOptions>) {
    return context.minify(value, options.toBaseConfig());
}