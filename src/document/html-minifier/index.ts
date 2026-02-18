import type { ITransformSeries } from '@e-mc/types/lib/document';

import type hm from 'html-minifier';

async function transform(context: typeof hm, value: string, options: ITransformSeries<hm.Options>) {
    return context.minify(value, options.toBaseConfig());
}

export = transform;