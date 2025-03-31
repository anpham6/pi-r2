import path = require('node:path');
import fs = require('node:fs');
import types = require('@e-mc/types');

import Image = require('@e-mc/image');

export const MIME_INPUT = new Set([
    Image.MIME_PNG,
    Image.MIME_JPEG,
    Image.MIME_BMP,
    Image.MIME_GIF,
    Image.MIME_TIFF,
    Image.MIME_WEBP
]);

export const MIME_OUTPUT = new Set([
    Image.MIME_PNG,
    Image.MIME_JPEG,
    Image.MIME_BMP,
    Image.MIME_GIF,
    Image.MIME_TIFF,
    Image.MIME_WEBP
]);

export function parseFormat(command: string, mimeType?: string): [string, string, string] {
    command = command.toLowerCase();
    for (let mime of MIME_OUTPUT) {
        let saveAs: string | undefined = mime.split('/')[1];
        if (command.startsWith(saveAs)) {
            let outputAs = '';
            switch (saveAs) {
                case 'jpeg':
                    saveAs = 'jpg';
                    break;
                case 'webp':
                    if (saveAs = getExtension(mimeType)) {
                        mime = mimeType!;
                    }
                    else {
                        mime = Image.MIME_BMP;
                        saveAs = 'bmp';
                    }
                    outputAs = 'webp';
                    break;
            }
            return [mime, saveAs, outputAs];
        }
    }
    return ['', '', ''];
}

export function getExtension(mimeType: string | undefined) {
    switch (mimeType) {
        case Image.MIME_JPEG:
            return 'jpg';
        case Image.MIME_PNG:
            return 'png';
        case Image.MIME_GIF:
            return 'gif';
        case Image.MIME_BMP:
            return 'bmp';
        case Image.MIME_TIFF:
            return 'tiff';
    }
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
    return `"${value.replace(/"/g, '\\"')}"`;
}

export async function importBinary(name: string, pathname: string | undefined): Promise<string> {
    if (pathname && fs.existsSync(pathname)) {
        name += Image.PLATFORM_WIN32 ? '.exe' : '';
        const bin = path.join(pathname, name);
        return types.sanitizeCmd(fs.existsSync(bin) ? bin : path.join(pathname, 'bin', name));
    }
    return types.importESM(name + '-bin', true);
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