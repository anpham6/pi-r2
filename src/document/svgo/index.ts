import type { ITransformSeries } from '@e-mc/types/lib/document';

import type { Plugin } from 'svgo/lib/types';

import type * as svgo from 'svgo';

import types = require('@e-mc/types');

import Document = require('@e-mc/document');
import Parse = require('@e-mc/document/parse/dom');

import { ERR_MESSAGE } from '@e-mc/types/constant';

interface CustomPlugin {
    name: string;
    fn?: Plugin<void> | string;
}

function transform(context: typeof svgo, value: string, options: ITransformSeries<svgo.Config>) {
    context = options.upgrade(context, __dirname);
    const baseConfig = options.toBaseConfig();
    const plugins = baseConfig.plugins;
    if (Array.isArray(plugins)) {
        for (let i = 0; i < plugins.length; ++i) {
            const item = plugins[i];
            if (types.isPlainObject<CustomPlugin>(item) && types.isString(item.fn)) {
                const fn = Document.parseFunction(item.fn, { absolute: true, external: true });
                if (fn) {
                    item.fn = fn as Plugin<void>;
                }
                else {
                    plugins.splice(i--, 1);
                    options.addLog(options.logType.PROCESS, ERR_MESSAGE.FUNCTION + ` (${item.fn})`, options.moduleName, 'svgo');
                }
            }
        }
    }
    delete baseConfig.path;
    if ((options.metadata as AnyObject).__fromhtml__ || /<html[\s>]/i.test(value) && /<\/html\s*>/i.test(value)) {
        const { element } = Parse.DomWriter.getDocumentElement(value);
        if (element) {
            const segments: string[] = [];
            const svg: string[] = [];
            let lastIndex = 0;
            for (const item of Parse.DomWriter.getElementsByTagName('svg', element, true)) {
                segments.push(value.substring(lastIndex, item.startIndex!));
                svg.push(value.substring(item.startIndex!, lastIndex = item.endIndex! + 1));
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
                return source + value.substring(lastIndex);
            }
        }
        return value;
    }
    return context.optimize(value, baseConfig).data;
}

export = transform;