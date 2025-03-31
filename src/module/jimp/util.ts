import path = require('node:path');
import fs = require('node:fs');
import types = require('@e-mc/types');

import jimp = require('jimp');

import Image = require('@e-mc/image');

const enum STRINGS {
    MIME_WEBP = 'image/webp'
}

export const MIME_INPUT = new Set([
    jimp.JimpMime.png,
    jimp.JimpMime.jpeg,
    jimp.JimpMime.bmp,
    jimp.JimpMime.gif,
    jimp.JimpMime.tiff,
    STRINGS.MIME_WEBP as string
]);

export const MIME_OUTPUT = new Set([
    jimp.JimpMime.png,
    jimp.JimpMime.jpeg,
    jimp.JimpMime.bmp,
    jimp.JimpMime.gif,
    STRINGS.MIME_WEBP as string
]);

export function parseFormat(command: string, mimeType?: string): [string, string, string] {
    command = command.toLowerCase();
    for (let mime of MIME_OUTPUT) {
        let saveAs = mime.split('/')[1];
        if (command.startsWith(saveAs)) {
            let outputAs = '';
            switch (saveAs) {
                case 'jpeg':
                    saveAs = 'jpg';
                    break;
                case 'webp':
                    mime = mimeType!;
                    if (mimeType === jimp.JimpMime.jpeg) {
                        saveAs = 'jpg';
                    }
                    else if (mimeType === jimp.JimpMime.png) {
                        saveAs = 'png';
                    }
                    else if (mimeType === jimp.JimpMime.gif) {
                        saveAs = 'gif';
                    }
                    else if (mimeType === jimp.JimpMime.tiff) {
                        saveAs = 'tiff';
                    }
                    else {
                        mime = jimp.JimpMime.jpeg;
                        saveAs = 'jpg';
                    }
                    outputAs = 'webp';
                    break;
            }
            return [mime, saveAs, outputAs];
        }
    }
    return ['', '', ''];
}

export function renameExt(output: string, ext: string, replace?: boolean) {
    let result = types.renameExt(output.replace('.__copy__.', '.'), ext);
    if (!replace) {
        const pathname = result;
        let i = 0;
        while (Image.isPath(result)) {
            result = pathname.substring(0, pathname.lastIndexOf('.') + 1) + `(${++i}).` + ext;
        }
    }
    return result;
}

export function normalizePath(value: string) {
    return '"' + value.replace(/"/g, '\\"') + '"';
}

export function getWebP_bin(name: string, pathname: string | undefined): string {
    if (pathname && fs.existsSync(pathname)) {
        name += Image.PLATFORM_WIN32 ? '.exe' : '';
        const bin = path.join(pathname, name);
        return Image.sanitizeCmd(fs.existsSync(bin) ? bin : path.join(pathname, 'bin', name));
    }
    return require(name + '-bin');
}

export function showInputType(value: string | undefined, outputType: string, finalAs: string) {
    if (finalAs) {
        outputType = 'image/' + finalAs;
    }
    return value && outputType !== value ? value.split('/').pop() + ' -> ' : '';
}

export function showOutputType(value: string | undefined, outputType: string, finalAs: string) {
    if (finalAs) {
        outputType = 'image/' + finalAs;
    }
    return value !== outputType ? ' -> ' + outputType.split('/').pop() : '';
}