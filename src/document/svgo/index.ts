import type { ITransformSeries } from '@e-mc/types/lib/document';

import type * as svgo from 'svgo';

import { ERR_MESSAGE } from '@e-mc/types/constant';

import Document from '@e-mc/document';

import { DomWriter } from '@e-mc/document/parse/dom';
import { isPlainObject } from '@e-mc/document/util';

interface CustomPlugin {
    name: string;
    fn?: svgo.Plugin<void> | string;
}

export default function transform(context: typeof svgo, value: string, options: ITransformSeries<svgo.Config>) {
    context = options.upgrade(context, __dirname);
    const baseConfig = options.toBaseConfig();
    const plugins = baseConfig.plugins;
    if (Array.isArray(plugins)) {
        for (let i = 0; i < plugins.length; ++i) {
            const item = plugins[i] as unknown;
            if (isPlainObject<CustomPlugin>(item) && item.fn) {
                const fn = Document.parseFunction(item.fn, { absolute: true, external: true, default: true });
                if (fn) {
                    item.fn = fn as svgo.Plugin<void>;
                }
                else {
                    plugins.splice(i--, 1);
                    options.addLog(options.logType.PROCESS, ERR_MESSAGE.FUNCTION + (typeof item.fn === 'string' ? ` (${item.fn})` : ''), { source: 'svgo' });
                }
            }
        }
    }
    delete baseConfig.path;
    if ((options.metadata as AnyObject).__fromhtml__ || /<html[\s>]/i.test(value) && /<\/html\s*>/i.test(value)) {
        const { element } = DomWriter.getDocumentElement(value);
        if (element) {
            const segments: string[] = [];
            const svg: string[] = [];
            let lastIndex = 0;
            for (const item of DomWriter.getElementsByTagName('svg', element, true)) {
                segments.push(value.slice(lastIndex, item.startIndex!));
                svg.push(value.slice(item.startIndex!, lastIndex = item.endIndex! + 1));
            }
            if (svg.length > 0) {
                let source = '';
                do {
                    const seg = svg.shift()!;
                    let data: string | undefined;
                    try {
                        ({ data } = context.optimize(seg, baseConfig));
                    }
                    catch {
                    }
                    source += segments.shift()! + (data || seg);
                }
                while (svg.length > 0);
                return source + value.slice(lastIndex);
            }
        }
        return value;
    }
    return context.optimize(value, baseConfig).data;
}