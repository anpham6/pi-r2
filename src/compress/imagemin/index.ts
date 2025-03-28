/* eslint import/no-unresolved: "off" */

import type { ICompress } from '@e-mc/types/lib';
import type { CompressModule } from '@e-mc/types/lib/settings';

import jpegtran from 'imagemin-jpegtran';
import mozjpeg from 'imagemin-mozjpeg';
import pngquant from 'imagemin-pngquant';
import optipng from 'imagemin-optipng';
import webp from 'imagemin-webp';
import gifsicle from 'imagemin-gifsicle';
// @ts-expect-error
import svgo from 'imagemin-svgo';

import { fileTypeFromBuffer } from 'file-type';

import { errorMessage, importESM, isPlainObject } from '@e-mc/types';

interface ImageminModule extends CompressModule {
    imagemin?: {
        jpegtran?: AnyObject;
        mozjpeg?: AnyObject;
        pngquant?: AnyObject;
        optipng?: AnyObject;
        webp?: AnyObject;
        gifsicle?: AnyObject;
        svgo?: AnyObject;
    };
}

type Plugin = (input: Uint8Array) => Promise<Uint8Array>;

const PLUGIN_MAP: ObjectMap<FunctionType> = Object.freeze({
    'jpegtran': jpegtran,
    'imagemin-jpegtran': jpegtran,
    'mozjpeg': mozjpeg,
    'imagemin-mozjpeg': mozjpeg,
    'pngquant': pngquant,
    'imagemin-pngquant': pngquant,
    'optipng': optipng,
    'imagemin-optipng': optipng,
    'webp': webp,
    'imagemin-webp': webp,
    'gifsicle': gifsicle,
    'imagemin-gifsicle': gifsicle,
    'svgo': svgo,
    'imagemin-svgo': svgo
});

export default function compress(this: ICompress<ImageminModule> | undefined, options: AnyObject | undefined, mimeType?: string) {
    let plugin = options?.__plugin__ as string | undefined,
        settings: ImageminModule["imagemin"] | undefined;
    if (isPlainObject<CompressModule>(this?.module) && (settings = this.module.imagemin) && !plugin) {
        switch (mimeType) {
            case 'image/jpeg':
                plugin = settings.jpegtran ? 'jpegtran' : 'mozjpeg';
                break;
            case 'image/png':
                plugin = settings.optipng ? 'optipng' : 'pngquant';
                break;
        }
    }
    return async (data: Buffer | Uint8Array) => {
        if (!plugin) {
            if (!mimeType) {
                const value = await fileTypeFromBuffer(data);
                if (value) {
                    mimeType = value.mime;
                }
            }
            switch (mimeType) {
                case 'image/jpeg':
                    plugin = 'mozjpeg';
                    break;
                case 'image/png':
                    plugin = 'pngquant';
                    break;
                case 'image/webp':
                    plugin = 'webp';
                    break;
                case 'image/gif':
                    plugin = 'gifsicle';
                    break;
                case 'image/svg+xml':
                    plugin = 'svgo';
                    break;
            }
        }
        if (!plugin) {
            return Promise.reject(errorMessage('imagemin', 'Missing plugin name', mimeType));
        }
        const transform = PLUGIN_MAP[plugin] || await importESM(plugin, true);
        if (typeof transform !== 'function') {
            return Promise.reject(errorMessage('imagemin', 'Invalid transform function', plugin));
        }
        return (transform(options || settings?.[plugin.replace(/^imagemin-/, '') as "jpegtran"]) as Plugin)(data);
    };
}