import type { ITransformSeries } from '@e-mc/types/lib/document';

import type * as hm from 'html-minifier';

export default async function transform(context: typeof hm, value: string, options: ITransformSeries<hm.Options>) {
    return context.minify(value, options.toBaseConfig());
}