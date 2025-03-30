import type { WorkerAction } from '@e-mc/types/lib/squared';

import type { IFileManager, IHost } from '@e-mc/types/lib';
import type { ExternalAsset, IFileThread, OutputFinalize } from '@e-mc/types/lib/asset';
import type { CommandData, CropData, QualityData, ResizeData, RotateData, TransformOptions } from '@e-mc/types/lib/image';
import type { LogTime } from '@e-mc/types/lib/logger';
import type { ExecAction } from '@e-mc/types/lib/module';
import type { ImageModule } from '@e-mc/types/lib/settings';

import type { WebpMux } from '@e-mc/image/types';

import type { IJimpHandler, JimpImageConstructor, JimpSettings, ResultCallback, WorkerMessage } from './types';

import type { JimpInstance } from 'jimp';
import type { DecodeJpegOptions } from "@jimp/js-jpeg";

import type * as gw from 'gifwrap';

import { ERR_IMAGE, ERR_MESSAGE, LOG_TYPE } from '@e-mc/types/constant';

import path = require('node:path');
import fs = require('node:fs');
import crypto = require('node:crypto');
import child_process = require('node:child_process');
import jimp = require('jimp');
import jimp_utils = require('@jimp/utils');
import gifwrap = require('gifwrap');
import bmp = require('bmp-js');

import { WorkerChannel } from '@e-mc/core';

const Image = require('@e-mc/image') as JimpImageConstructor<IFileManager>;

import { createAbortError, errorMessage, errorValue, isPlainObject, isString, parseExpires, renameExt } from '@e-mc/types';

import util = require('./util');

const kJimp = Symbol.for('jimp:constructor');

let WEBPMUX: WebpMux | null = null,
    WEBPMUX_INIT = false;

try {
    WEBPMUX = require('node-webpmux') as WebpMux;
    void new WEBPMUX.Image().initLib().then(() => WEBPMUX_INIT = true);
}
catch {
}

interface CacheData {
    tempKey: string;
    tempFile: string;
    ctimeMs: number;
    localFile?: string;
    mtimeMs?: number;
    size?: number;
}

const enum STRINGS {
    MODULE_NAME = 'jimp',
    TRANSFORM = 'Transforming image...'
}

function createWorker(filename: string) {
    const { PIR2_JIMP_WORKER_MIN: min, PIR2_JIMP_WORKER_MAX: max, PIR2_JIMP_WORKER_TIMEOUT: timeout } = process.env;
    const result = new WorkerChannel(path.join(__dirname, 'worker', filename), undefined, max ? parseInt(max) : undefined, timeout ? parseInt(timeout) * 1000 : undefined);
    if (min) {
        result.min = parseInt(min);
    }
    return result;
}

const CACHE_TRANSFORM: ObjectMap<CacheData> = {};
const WORKER = Object.freeze({
    jimp: createWorker('jimp.js')
});
let CACHE_INIT = false;
let TEMP_DIR = '';

const METHOD_ALIAS = Object.freeze({
    contain: 'ct',
    cover: 'cv',
    resize: 're',
    scale: 'sc',
    scaleToFit: 'sf',
    autocrop: 'au',
    crop: 'cr',
    blit: 'bt',
    composite: 'cp',
    mask: 'ma',
    convolute: 'cl',
    convolution: 'cu',
    flip: 'fl',
    rotate: 'ro',
    brightness: 'br',
    contrast: 'cn',
    dither: 'dt',
    greyscale: 'gr',
    invert: 'in',
    normalize: 'no',
    fade: 'fa',
    opacity: 'op',
    opaque: 'oq',
    background: 'bg',
    gaussian: 'ga',
    blur: 'bl',
    posterize: 'po',
    sepia: 'se',
    pixelate: 'px',
    displace: 'dp',
    color: 'co',
    circle: 'ci',
    fisheye: 'fe',
    threshold: 'th',
    quantize: 'qu'
});
const METHOD_NONE = Object.freeze(['sepia', 'normalize', 'invert', 'greyscale', 'dither']);

type MethodName = keyof typeof METHOD_ALIAS;

function getMethodName(value: string) {
    if (value.length === 2) {
        value = value.toLowerCase();
        for (const alias in METHOD_ALIAS) {
            if (METHOD_ALIAS[alias as MethodName] === value) {
                return alias as MethodName;
            }
        }
    }
    else if (METHOD_ALIAS[value as MethodName] || METHOD_ALIAS[value = value.toLowerCase() as MethodName]) {
        return value as MethodName;
    }
}

async function performCommand(host: IHost | null, instance: Jimp, localUri: string, command: string | CommandData, outputType: string, outputAs: string, { buffer, mimeType, parent }: { buffer?: string | Buffer | null; mimeType?: string; parent?: ExternalAsset } = {}) {
    const options = mimeType ? instance.settings.jimp?.read_options?.[mimeType] : undefined;
    return jimp.Jimp.read(buffer || localUri, isPlainObject<DecodeJpegOptions>(options) ? { [mimeType as "image/jpeg"]: options } : undefined).then(async img => {
        return transformCommand(
            localUri,
            new JimpHandler(img as JimpInstance, instance, host),
            command,
            outputType,
            outputAs,
            parent
        );
    });
}

function execOptions(settings: JimpSettings) {
    const exec = settings.jimp?.exec;
    let uid: number | undefined,
        gid: number | undefined;
    if (isPlainObject<ExecAction>(exec)) {
        let { uid: u, gid: g } = exec;
        if ((u = parseInt(u as string)) >= 0) {
            uid = u;
        }
        if ((g = parseInt(g as string)) >= 0) {
            gid = g;
        }
    }
    return { uid, gid };
}

async function transformCommand(localFile: string, handler: JimpHandler, command: string | CommandData, outputType: string, outputAs?: string, parent?: ExternalAsset) {
    if (command) {
        handler.instance.setCommand(command, outputAs);
    }
    handler.instance.outputType = outputType;
    await handler.method();
    handler.resize();
    handler.crop();
    if (outputType !== Image.MIME_JPEG) {
        handler.opacity();
    }
    switch (handler.rotateCount) {
        case 0:
            break;
        case 1:
            await handler.rotate();
            break;
        default:
            await handler.rotate(localFile, (err, result) => {
                if (!err) {
                    try {
                        handler.host?.add(result, parent);
                    }
                    catch {
                    }
                }
            });
            break;
    }
    return handler;
}

async function setImageCache(instance: Jimp, tempKey: string, tempFile: string, output: Bufferable, localFile?: string) {
    try {
        if (typeof output === 'string') {
            await fs.promises.copyFile(output, tempFile);
        }
        else {
            await fs.promises.writeFile(tempFile, output);
        }
        const stored = getCacheData(instance);
        if (localFile) {
            const { ctimeMs, mtimeMs, size } = fs.statSync(localFile);
            stored[tempKey] = { tempKey, tempFile, ctimeMs, localFile, mtimeMs, size };
        }
        else {
            stored[tempKey] = { tempKey, tempFile, ctimeMs: Date.now() };
        }
        if (instance.settings.jimp?.cache_expires) {
            fs.writeFile(tempFile + '.json', JSON.stringify(stored[tempKey]), 'utf8', () => {});
        }
    }
    catch {
        TEMP_DIR = '';
    }
}

function getImageCache(instance: Jimp, tempKey: string): [Buffer | null, string?, number?] {
    const stored = getCacheData(instance);
    const data = stored[tempKey];
    if (data) {
        const { tempFile, localFile, ctimeMs, mtimeMs, size } = data;
        try {
            if (!localFile) {
                return [fs.readFileSync(tempFile), '', ctimeMs];
            }
            const stat = fs.statSync(localFile);
            if (stat.mtimeMs === mtimeMs && stat.size === size) {
                return [fs.readFileSync(tempFile), '', ctimeMs];
            }
        }
        catch {
            TEMP_DIR = '';
        }
        removeFile(tempFile);
        delete stored[tempKey];
    }
    TEMP_DIR ||= instance.getTempDir({ moduleDir: true, increment: 5 });
    return [null, TEMP_DIR ? path.join(TEMP_DIR, crypto.randomUUID()) : ''];
}

function getCacheData(instance: Jimp) {
    if (!CACHE_INIT) {
        TEMP_DIR = instance.getTempDir({ moduleDir: true, increment: 5 });
        const settings = instance.settings.jimp ||= {};
        const expires = parseExpires(settings.cache_expires || 0);
        if (settings.worker) {
            let { min = -1, max = -1, expires = 0 } = settings.worker;
            if ((min = Math.trunc(+min)) >= 0) {
                WORKER.jimp.min = min;
            }
            if ((max = Math.trunc(+max)) >= 0) {
                WORKER.jimp.max = max;
            }
            if ((expires = parseExpires(expires)) > 0) {
                WORKER.jimp.timeoutMs = expires;
            }
        }
        if (expires === 0) {
            settings.cache_expires = 0;
        }
        if (TEMP_DIR) {
            if (expires === 0) {
                Image.removeDir(TEMP_DIR, true);
            }
            else {
                try {
                    const current = Date.now();
                    fs.readdirSync(TEMP_DIR, { withFileTypes: true }).forEach(item => {
                        if (item.isFile() && path.extname(item.name) === '.json') {
                            const pathname = path.join(TEMP_DIR, item.name);
                            try {
                                const data = JSON.parse(fs.readFileSync(pathname, 'utf8')) as unknown;
                                if (isPlainObject<CacheData>(data) && fs.existsSync(data.tempFile)) {
                                    if (data.ctimeMs + expires > current) {
                                        CACHE_TRANSFORM[data.tempKey] = data;
                                        return;
                                    }
                                    removeFile(data.tempFile);
                                }
                            }
                            catch {
                            }
                            removeFile(pathname);
                        }
                    });
                }
                catch {
                }
            }
        }
        CACHE_INIT = true;
    }
    return CACHE_TRANSFORM;
}

function formatMessage(instance: Jimp, value: string, startTime: LogTime | undefined, failed: boolean, cTimeMs?: number) {
    if (cTimeMs) {
        instance.formatMessage(LOG_TYPE.IMAGE, STRINGS.MODULE_NAME, [value, 'cache'], new Date(cTimeMs).toLocaleString(), { ...Image.LOG_STYLE_NOTICE, hintBold: true });
    }
    else if (startTime) {
        instance.writeTimeProcess(STRINGS.MODULE_NAME, value, startTime, { type: LOG_TYPE.IMAGE, failed });
    }
}

function getTempPath(instance: Jimp, ext: string) {
    const tempDir = TEMP_DIR || instance.getTempDir({ moduleDir: true, createDir: true }) || instance.getTempDir();
    return path.join(tempDir, crypto.randomUUID() + '.' + ext);
}

function rotateAnim(cmd: CommandData) {
    const rotate = cmd.rotate;
    if (rotate) {
        rotate.values = [rotate.values.pop()!];
    }
}

function removeFile(pathname: string) {
    fs.unlink(pathname, () => {});
}

function getJPEGOptions(data: Optional<QualityData>, output: string, outputType: string) {
    if (data) {
        switch (path.extname(output).toLowerCase()) {
            case '.jpeg':
            case '.jpg':
            case '.jpe':
                break;
            default:
                if (outputType === Image.MIME_JPEG) {
                    break;
                }
                return;
        }
        return { quality: data.value } as jimp.JPEGOptions;
    }
}

const hasTransform = (cmd: CommandData) => !!(cmd.rotate || cmd.resize || cmd.crop || cmd.method || typeof cmd.opacity === 'number' && cmd.opacity >= 0 && cmd.opacity < 1);
const isUnsupported = (value: string) => value === Image.MIME_GIF || value === Image.MIME_WEBP;
const emptyResult = <T>(options: TransformOptions) => (options.tempFile ? '' : null) as T;

class JimpHandler<T extends JimpInstance = JimpInstance> implements IJimpHandler<IFileManager, ImageModule<JimpSettings>, T> {
    outFile = '';

    constructor(
        public handler: T,
        public instance: Jimp,
        private readonly _host: IHost | null = null) {
    }

    async rotate(localFile?: string, callback?: ResultCallback<string>) {
        const data = this.instance.rotateData;
        if (!data || this.aborted) {
            return;
        }
        if (!localFile) {
            Jimp.applyRotate(this.handler, data);
            return;
        }
        Jimp.applyBackground(this.handler, data);
        const leading = localFile.substring(0, localFile.lastIndexOf('.') + 1);
        const ext = path.extname(localFile);
        const tasks: Promise<void>[] = [];
        for (const value of data.values) {
            const img = this.handler.clone().rotate(value);
            const output = leading + value + ext;
            tasks.push(
                img.write(output as "jimp.png")
                    .then(() => {
                        this.finalize(output, callback);
                    })
                    .catch((err: unknown) => {
                        this.instance.writeFail([ERR_IMAGE.ROTATE, STRINGS.MODULE_NAME], err, LOG_TYPE.IMAGE);
                    })
            );
        }
        await Promise.all(tasks);
    }
    async method() {
        const data = this.instance.methodData;
        if (!data || this.aborted) {
            return;
        }
        for (const [name, args = []] of data) {
            try {
                const alias = getMethodName(name);
                if (!alias) {
                    throw errorValue(ERR_IMAGE.METHOD_NAME, name);
                }
                const errorParameters = (value: unknown) => {
                    throw errorMessage(alias, ERR_MESSAGE.PARAMETERS, JSON.stringify(value));
                };
                switch (alias) {
                    case 'composite': {
                        const [src, x, y, opts] = args;
                        if (isString(src) && typeof x === 'number' && typeof y === 'number') {
                            this.handler.composite(await jimp.Jimp.read(src), x, y, opts as undefined);
                        }
                        else {
                            errorParameters(args);
                        }
                        break;
                    }
                    case 'background':
                        if (args.length === 4) {
                            this.background(args as [number, number, number, number]);
                            break;
                        }
                        if (args.length === 1) {
                            if (typeof args[0] === 'number') {
                                this.background(args[0]);
                                break;
                            }
                            if (Array.isArray(args[0])) {
                                this.background(args[0] as [number, number, number, number]);
                                break;
                            }
                        }
                        errorParameters(args);
                        break;
                    default: {
                        if (METHOD_NONE.includes(alias)) {
                            this.handler[alias]();
                            break;
                        }
                        const arg = args.shift();
                        switch (alias) {
                            case 'blur':
                            case 'gaussian':
                            case 'brightness':
                            case 'contrast':
                            case 'posterize':
                            case 'opacity':
                            case 'fade':
                                if (isPlainObject(arg)) {
                                    errorParameters(args);
                                }
                                this.handler[alias](+(arg as string));
                                break;
                            case 'pixelate':
                            case 'convolute':
                                (this.handler[alias] as FunctionType<JimpInstance>)(arg);
                                break;
                            default:
                                if (!isPlainObject(arg)) {
                                    errorParameters(arg);
                                }
                                (this.handler[alias] as FunctionType<JimpInstance>)(arg);
                                break;
                        }
                        break;
                    }
                }
                if (args.length > 0) {
                    this.instance.addLog(this.instance.statusType.WARN, ERR_MESSAGE.PARAMETERS + `: ${args.join(', ')}`, alias);
                }
            }
            catch (err) {
                this.instance.writeFail([ERR_MESSAGE.UNKNOWN, STRINGS.MODULE_NAME + ': ' + name], err, LOG_TYPE.IMAGE);
            }
        }
    }
    resize() {
        const data = this.instance.resizeData;
        if (!data || this.aborted) {
            return;
        }
        Jimp.applyResize(this.handler, data);
    }
    background(value: number | [number, number, number, number]) {
        this.handler.background = Array.isArray(value) ? jimp_utils.rgbaToInt(...value) : value;
    }
    finalize(output: string, callback?: ResultCallback<string>) {
        if (this.aborted) {
            return;
        }
        const instance = this.instance;
        if (instance.outputAs === 'webp' && path.extname(output).toLowerCase() !== '.webp') {
            const settings = instance.settings;
            const webp = settings.webp ||= {};
            const data = instance.qualityData;
            const replace = instance.getCommand().includes('@');
            const outFile = this.outFile || util.renameExt(output, 'webp', replace);
            const args = [util.normalizePath(output)];
            if (data) {
                const { value, preset, nearLossless } = data;
                if (preset) {
                    args.push('-preset', preset);
                }
                if (value > 100) {
                    args.push('-lossless');
                }
                else if (value >= 0) {
                    args.push('-q', value.toString());
                }
                if (nearLossless >= 0) {
                    args.push('-near_lossless', Math.min(nearLossless, 100).toString());
                }
            }
            if (Array.isArray(webp.cwebp)) {
                for (let i = 0; i < webp.cwebp.length; ++i) {
                    const arg = webp.cwebp[i];
                    switch (arg) {
                        case '-h':
                        case '-H':
                        case '-version':
                            continue;
                        case '-o':
                        case '--':
                            ++i;
                            break;
                        case '-preset':
                        case '-q':
                        case '-near_lossless':
                            if (args.includes(arg) || arg !== '-preset' && args.includes('-lossless')) {
                                ++i;
                                break;
                            }
                        default:
                            args.push(arg);
                            break;
                    }
                }
            }
            args.push('-o', util.normalizePath(outFile));
            try {
                child_process.execFile(util.getWebP_bin('cwebp', webp.path), args, { shell: true, signal: this.instance.signal, ...execOptions(settings) }, err => {
                    if (err) {
                        this.instance.writeFail([ERR_MESSAGE.CONVERT_FILE, path.basename(outFile)], err, LOG_TYPE.IMAGE);
                    }
                    else if (output !== outFile) {
                        const tempFile = output;
                        queueMicrotask(() => {
                            fs.unlink(tempFile, error => {
                                if (!error) {
                                    fs.rmdir(path.dirname(tempFile), () => {});
                                }
                            });
                        });
                        output = outFile;
                    }
                    if (callback) {
                        callback(err, output);
                    }
                });
            }
            catch (err) {
                this.instance.checkPackage(err, 'cwebp-bin@6.1.2', ERR_MESSAGE.UNKNOWN, { type: LOG_TYPE.IMAGE, passThrough: !!callback });
                if (callback) {
                    callback(err, '');
                }
            }
        }
        else if (callback) {
            callback(null, output);
        }
    }
    async getBuffer(tempFile?: boolean, saveAs?: string) {
        const emptyData = () => tempFile ? '' : null;
        const output = getTempPath(this.instance, saveAs && util.MIME_OUTPUT.has('image/' + (saveAs === 'jpg' ? 'jpeg' : saveAs)) ? saveAs : (this.handler.mime || this.instance.outputType).split('/').pop()!);
        if (!output) {
            return emptyData();
        }
        return new Promise<Bufferable | null>(resolve => {
            this.handler.write(output as "jimp.jpg", getJPEGOptions(this.instance.qualityData, output, this.instance.outputType))
                .then(() => {
                    this.finalize(output, (error, result) => {
                        if (error) {
                            resolve(emptyData());
                        }
                        else if (tempFile) {
                            resolve(result || output);
                        }
                        else {
                            try {
                                resolve(fs.readFileSync(result));
                            }
                            catch (err) {
                                this.instance.writeFail([ERR_MESSAGE.READ_FILE, path.basename(result)], err, LOG_TYPE.FILE);
                                resolve(null);
                            }
                            finally {
                                fs.unlink(result, err => {
                                    if (!err) {
                                        this.instance.emit('file:delete', result);
                                    }
                                });
                            }
                        }
                    });
                })
                .catch(() => {
                    resolve(emptyData());
                });
        });
    }
    crop() {
        if (this.aborted) {
            return;
        }
        const data = this.instance.cropData;
        if (data) {
            Jimp.applyCrop(this.handler, data);
        }
    }
    opacity() {
        const value = this.instance.opacityValue ?? NaN;
        if (value >= 0 && !this.aborted) {
            this.handler.opacity(value);
        }
    }
    async write(output: string, callback?: ResultCallback<string>) {
        if (this.aborted) {
            if (callback) {
                callback(createAbortError(), '');
            }
            return;
        }
        if (this.instance.outputAs === 'webp') {
            this.outFile = output;
            output = this.writeAs(output);
        }
        return this.handler.write(output as "jimp.jpg", getJPEGOptions(this.instance.qualityData, output, this.instance.outputType))
            .then(() => {
                this.finalize(output, callback);
            })
            .catch((err: unknown) => {
                if (callback) {
                    callback(err, '');
                }
                else {
                    this.instance.writeFail([ERR_MESSAGE.WRITE_FILE, path.basename(output)], err, LOG_TYPE.IMAGE);
                }
            });
    }
    writeAs(value: string) {
        switch (this.instance.outputType) {
            case Image.MIME_JPEG:
                return renameExt(value, 'jpg');
            case Image.MIME_PNG:
                return renameExt(value, 'png');
            case Image.MIME_GIF:
                return renameExt(value, 'gif');
            case Image.MIME_BMP:
                return renameExt(value, 'bmp');
            default:
                return value;
        }
    }
    get host() {
        return this._host as IFileManager | null || this.instance.host;
    }
    get aborted() {
        return this.instance.aborted;
    }
    get rotateCount() {
        return this.instance.rotateData?.values.length || 0;
    }
}

class Jimp extends Image {
    static [kJimp] = true;

    static override async transform<T extends TransformOptions extends infer U ? U extends { tempFile: infer V } ? V extends true ? string : Buffer | null : never : never>(file: string | Buffer, command: string, options: TransformOptions = {}): Promise<T> {
        const [outputType, saveAs, outputAs] = util.parseFormat(command = command.trim(), options.mimeType);
        if (!outputType) {
            return emptyResult(options);
        }
        const instance = new Jimp(options.module);
        let buffer: Buffer | null = null;
        if (Buffer.isBuffer(file)) {
            const tempDir = TEMP_DIR || instance.getTempDir();
            if (!this.createDir(tempDir)) {
                return emptyResult(options);
            }
            try {
                const { ext } = await this.resolveMime(file) || { ext: 'unknown' };
                buffer = file;
                fs.writeFileSync(file = path.join(tempDir, crypto.randomUUID() + '.' + ext), buffer);
            }
            catch {
                return emptyResult(options);
            }
            options.cache = false;
        }
        const filename = path.basename(file);
        const broadcastId = options.broadcastId;
        if (broadcastId) {
            if (isPlainObject(broadcastId)) {
                instance.broadcastId = broadcastId.value;
                if (broadcastId.stripAnsi === false) {
                    instance.supports('stripAnsi', false);
                }
            }
            else {
                instance.broadcastId = broadcastId;
            }
        }
        const writeMessage = (failed: boolean, cTimeMs?: number) => {
            if (cTimeMs || options.startTime) {
                formatMessage(instance, filename + util.showOutputType(options.mimeType, outputType, outputAs), options.startTime, failed, cTimeMs);
            }
        };
        let tempKey: string | undefined,
            tempFile: string | undefined;
        if (options.cache) {
            let ctimeMs: number | undefined;
            [buffer, tempFile, ctimeMs] = getImageCache(instance, tempKey = file + command + (options.mimeType || ''));
            if (buffer) {
                writeMessage(false, ctimeMs);
                return buffer as T;
            }
        }
        instance.formatMessage(Image.LOG_TYPE.IMAGE, STRINGS.MODULE_NAME, [STRINGS.TRANSFORM, filename], command);
        Image.initCpuUsage(instance);
        return performCommand(null, instance, file, command, outputType, outputAs, { mimeType: options.mimeType })
            .then(async handler => {
                const result = await handler.getBuffer(options.tempFile, saveAs);
                instance.flushLog();
                writeMessage(!result || instance.errors.length > 0);
                if (result && tempKey && tempFile) {
                    void setImageCache(instance, tempKey, tempFile, result, file);
                }
                return result as T;
            })
            .catch(() => {
                return emptyResult<T>(options);
            })
            .finally(() => {
                if (buffer && !options.cache) {
                    removeFile(file);
                }
            });
    }

    static applyBackground(instance: JimpInstance, data: { color: number }) {
        if (!isNaN(data.color)) {
            instance.background = data.color;
        }
    }

    static applyResize(instance: JimpInstance, data: ResizeData) {
        this.applyBackground(instance, data);
        const { width: w, height: h } = data;
        let align = 0;
        switch (data.align[0]) {
            case 'left':
                align |= jimp.HorizontalAlign.LEFT;
                break;
            case 'center':
                align |= jimp.HorizontalAlign.CENTER;
                break;
            case 'right':
                align |= jimp.HorizontalAlign.RIGHT;
                break;
        }
        switch (data.align[1]) {
            case 'top':
                align |= jimp.VerticalAlign.TOP;
                break;
            case 'middle':
                align |= jimp.VerticalAlign.MIDDLE;
                break;
            case 'bottom':
                align |= jimp.VerticalAlign.BOTTOM;
                break;
        }
        switch (data.mode) {
            case 'contain':
                instance.contain({ w, h, align: align > 0 ? align : undefined });
                break;
            case 'cover':
                instance.cover({ w, h, align: align > 0 ? align : undefined });
                break;
            case 'scale':
                instance.scaleToFit({ w, h });
                break;
            default: {
                let mode: jimp.ResizeStrategy;
                switch (data.algorithm) {
                    case 'bilinear':
                        mode = jimp.ResizeStrategy.BILINEAR;
                        break;
                    case 'bicubic':
                        mode = jimp.ResizeStrategy.BICUBIC;
                        break;
                    case 'hermite':
                        mode = jimp.ResizeStrategy.HERMITE;
                        break;
                    case 'bezier':
                        mode = jimp.ResizeStrategy.BEZIER;
                        break;
                    default:
                        mode = jimp.ResizeStrategy.NEAREST_NEIGHBOR;
                        break;
                }
                const options = { mode } as jimp.ResizeOptions;
                if (w < Infinity) {
                    options.w = w;
                }
                if (h < Infinity) {
                    options.h = h;
                }
                instance.resize(options);
                break;
            }
        }
    }

    static applyCrop(instance: JimpInstance, data: CropData) {
        instance.crop({ x: data.x, y: data.y, w: data.width, h: data.height });
    }

    static applyRotate(instance: JimpInstance, data: RotateData) {
        this.applyBackground(instance, data);
        instance.rotate(data.values[0]);
    }

    protected _moduleName = STRINGS.MODULE_NAME;
    protected _threadable = true;

    resizeData: ResizeData | null = null;
    cropData: CropData | null = null;
    rotateData: RotateData | null = null;
    qualityData: QualityData | null = null;
    methodData: [string, unknown[]?][] | null = null;
    opacityValue: number = NaN;
    outputType = '';

    override parseRotate(value: string) {
        const data = super.parseRotate(value);
        if (data && this.settings.jimp?.rotate_clockwise) {
            const values = data.values;
            for (let i = 0; i < values.length; ++i) {
                values[i] *= -1;
            }
        }
        return data;
    }
    override parseWorker(command: string | CommandData, outputType: string) {
        if (typeof command === 'string') {
            command = this.parseCommand(command);
        }
        if (!isUnsupported(outputType)) {
            const { method, rotate } = command;
            if (rotate && rotate.values.length > 1) {
                return null;
            }
            if (method) {
                const values = method.map(item => [getMethodName(item[0]) || item[0], item[1]] as [string, unknown[]?]);
                if (!values.every(item => METHOD_NONE.includes(item[0]))) {
                    return null;
                }
                command.method = values;
            }
            return command;
        }
        return null;
    }

    async using(data: IFileThread<ExternalAsset & WorkerAction>, command: string) {
        if (this.aborted) {
            return createAbortError(true);
        }
        return new Promise<void>(async (resolve, reject) => {
            const { host, file } = data;
            const localUri = host.getLocalUri(data);
            const mimeType = host.getMimeType(data);
            if (!localUri || !util.MIME_INPUT.has(mimeType)) {
                reject(errorValue(ERR_MESSAGE.UNKNOWN, !localUri ? 'URI' : 'MIME'));
                return;
            }
            if (!this.canRead(localUri, { ownPermissionOnly: true })) {
                reject(errorValue(ERR_MESSAGE.UNSUPPORTED_READ, localUri));
                return;
            }
            const [outputType, saveAs, outputAs] = util.parseFormat(command = command.trim(), mimeType, true);
            if (!outputType) {
                reject(errorValue(ERR_MESSAGE.FORMAT, /^\w+/.exec(command)?.[0] || ERR_MESSAGE.UNKNOWN));
                return;
            }
            const replace = command.includes('@');
            const output = host.addCopy(data.getObject({ command, outputType }), saveAs, replace);
            if (!output) {
                reject(errorValue(ERR_MESSAGE.NOT_COPYABLE, outputType));
                return;
            }
            if (!this.canWrite(output, { ownPermissionOnly: true })) {
                reject(errorValue(ERR_MESSAGE.UNSUPPORTED_WRITE, output));
                return;
            }
            const startTime = process.hrtime();
            const success = (result: string, ctimeMs?: number) => {
                const filename = path.basename(result);
                if (file.document) {
                    host.writeImage(file.document, data.getObject<OutputFinalize<ExternalAsset>>({ command, output: result }));
                }
                if (host.getLocalUri(data) !== result) {
                    if (command.includes('%')) {
                        const files = host.filesToCompare.get(file);
                        if (files) {
                            files.push(result);
                        }
                        else {
                            host.filesToCompare.set(file, [result]);
                        }
                    }
                    else if (replace) {
                        host.replace(file, result);
                    }
                    else {
                        host.add(result, file);
                    }
                }
                if (replace && file.localUri !== output && !host.assets.find(item => item.localUri === output && !item.invalid)) {
                    host.filesToRemove.add(output);
                }
                formatMessage(this, util.showOutputType(mimeType, outputType, outputAs) + filename, startTime, false, ctimeMs);
                resolve();
            };
            let tempKey: string | undefined,
                tempFile: string | undefined;
            if (this.settings.cache && (file.etag || file.buffer)) {
                let buffer: Buffer | null,
                    ctimeMs: number | undefined;
                [buffer, tempFile] = getImageCache(this, tempKey = (file.etag || Image.asHash(file.buffer!)) + command + mimeType);
                if (buffer) {
                    const result = outputAs === 'webp' ? util.renameExt(output, 'webp', replace) : output;
                    fs.writeFileSync(result, file.buffer = buffer);
                    success(result, ctimeMs);
                    return;
                }
            }
            const outputData = this.parseCommand(command);
            const finalize = (value: string) => {
                if (tempFile && tempKey) {
                    void setImageCache(this, tempKey, tempFile, value);
                }
                if (replace) {
                    delete file.buffer;
                }
                success(value);
            };
            const transformBuffer = (bmpFile?: Bufferable) => {
                startMessage();
                performCommand(host, this, localUri, outputData, bmpFile ? Image.MIME_BMP : outputType, outputAs, { buffer: bmpFile || file.buffer, mimeType, parent: file })
                    .then(img => {
                        if (typeof bmpFile === 'string') {
                            removeFile(bmpFile);
                        }
                        if (outputType === Image.MIME_GIF) {
                            try {
                                const { GifUtil, GifFrame } = gifwrap;
                                const frame = new GifFrame(img.handler.bitmap);
                                GifUtil.quantizeSorokin(frame, 256);
                                GifUtil.write(output, [frame])
                                    .then(() => {
                                        finalize(output);
                                    })
                                    .catch(reject);
                            }
                            catch (err) {
                                reject(err);
                            }
                        }
                        else {
                            void img.write(output, (err, result) => {
                                if (!err && result) {
                                    finalize(result);
                                }
                                else {
                                    reject(err || new Error(ERR_MESSAGE.UNKNOWN));
                                }
                            });
                        }
                    })
                    .catch(reject);
            };
            const startMessage = () => {
                host.formatMessage(LOG_TYPE.IMAGE, STRINGS.MODULE_NAME, [STRINGS.TRANSFORM, path.basename(localUri)], command);
            };
            if (mimeType === Image.MIME_GIF && isUnsupported(outputType)) {
                const transformWebP = (target: string, modified: boolean) => {
                    if (outputAs === 'webp') {
                        if (!modified) {
                            startMessage();
                        }
                        const { path: webp_path, gif2webp } = this.settings.webp ||= {};
                        const webp = util.renameExt(output, 'webp', replace);
                        const args: string[] = [util.normalizePath(target)];
                        const quality = outputData.quality;
                        if (quality) {
                            const { value, method } = quality;
                            if (!isNaN(value)) {
                                args.push('-q', value.toString());
                            }
                            if (!isNaN(method)) {
                                args.push('-m', method.toString());
                            }
                        }
                        if (Array.isArray(gif2webp)) {
                            for (let i = 0, length = gif2webp.length; i < length; ++i) {
                                const arg = gif2webp[i];
                                switch (arg) {
                                    case '-o':
                                        ++i;
                                    case '-h':
                                    case '-version':
                                        continue;
                                    case '-q':
                                    case '-m':
                                        if (args.includes(arg)) {
                                            ++i;
                                            continue;
                                        }
                                        break;
                                    case '--':
                                        i = length;
                                        continue;
                                }
                                args.push(arg);
                            }
                        }
                        args.push('-o', util.normalizePath(webp));
                        try {
                            child_process.execFile(util.getWebP_bin('gif2webp', webp_path), args, { shell: true, signal: this.signal, ...execOptions(this.settings) }, (err, stdout) => {
                                if (!err) {
                                    this.addLog(this.statusType.INFO, stdout);
                                    finalize(webp);
                                }
                                else {
                                    reject(err);
                                }
                            });
                        }
                        catch (err) {
                            if (this.checkPackage(err, 'gif2webp-bin@3', LOG_TYPE.IMAGE)) {
                                resolve();
                            }
                            else {
                                reject(err);
                            }
                        }
                    }
                    else if (modified) {
                        finalize(output);
                    }
                    else {
                        resolve();
                    }
                };
                if (hasTransform(outputData)) {
                    try {
                        startMessage();
                        const { GifUtil, BitmapImage } = gifwrap;
                        GifUtil.read(file.buffer || localUri)
                            .then(src => {
                                rotateAnim(outputData);
                                Promise.all(src.frames.map(async frame => {
                                    const bitmap = bmp.encode(frame.bitmap).data;
                                    const instance = await jimp.Jimp.read(bitmap) as JimpInstance;
                                    const handler = new JimpHandler(instance, this);
                                    return transformCommand(localUri, handler, outputData, Image.MIME_GIF);
                                }))
                                .then(items => {
                                    const quantize = this.settings.jimp?.gifwrap_quantize || '';
                                    const frames = src.frames;
                                    for (let i = 0, length = items.length; i < length; ++i) {
                                        const img = new BitmapImage(items[i].handler.bitmap);
                                        switch (quantize) {
                                            case 'none':
                                                break;
                                            case 'dekker':
                                                GifUtil.quantizeDekker(img, 256);
                                                break;
                                            case 'wu':
                                                GifUtil.quantizeWu(img, 256);
                                                break;
                                            default:
                                                GifUtil.quantizeSorokin(img, 256);
                                                break;
                                        }
                                        frames[i].bitmap = img.bitmap;
                                    }
                                    GifUtil.write(output, frames, src)
                                        .then(() => {
                                            transformWebP(output, true);
                                        })
                                        .catch(reject);
                                })
                                .catch(reject);
                            })
                            .catch(reject);
                    }
                    catch (err) {
                        reject(err);
                    }
                }
                else {
                    transformWebP(localUri, false);
                }
            }
            else if (mimeType === Image.MIME_WEBP) {
                const tryWebpMux = async () => {
                    try {
                        const webp = new (WEBPMUX ||= require('node-webpmux') as WebpMux).Image();
                        if (!WEBPMUX_INIT) {
                            await webp.initLib();
                            WEBPMUX_INIT = true;
                        }
                        await webp.load(host.getBuffer(file)!);
                        if (!(webp.hasAnim && (outputType === Image.MIME_WEBP || outputType === Image.MIME_GIF))) {
                            const buffer = Image.toABGR(await (!webp.hasAnim ? webp.getImageData() : webp.getFrameData(0)));
                            const bitmap = bmp.encode({ width: webp.width, height: webp.height, data: buffer }).data;
                            transformBuffer(bitmap);
                            return true;
                        }
                        if (hasTransform(outputData)) {
                            startMessage();
                            Promise.all(webp.frames.map(async (frame, index) => {
                                const buffer = Image.toABGR(await webp.getFrameData(index));
                                const bitmap = bmp.encode({ width: frame.width, height: frame.height, data: buffer }).data;
                                const instance = await jimp.Jimp.read(bitmap) as JimpInstance;
                                const handler = new JimpHandler(instance, this);
                                handler.background(webp.anim.bgColor);
                                return transformCommand(localUri, handler, outputData, Image.MIME_BMP);
                            }))
                            .then(items => {
                                const length = items.length;
                                if (outputType === Image.MIME_GIF) {
                                    try {
                                        const { GifFrame, GifUtil, BitmapImage } = gifwrap;
                                        const quantize = this.settings.jimp?.gifwrap_quantize || '';
                                        const frames: gw.GifFrame[] = new Array(length);
                                        for (let i = 0; i < length; ++i) {
                                            const { x, y, delay } = webp.frames[i];
                                            const img = new BitmapImage(items[i].handler.bitmap);
                                            switch (quantize) {
                                                case 'none':
                                                    break;
                                                case 'dekker':
                                                    GifUtil.quantizeDekker(img, 256);
                                                    break;
                                                case 'wu':
                                                    GifUtil.quantizeWu(img, 256);
                                                    break;
                                                default:
                                                    GifUtil.quantizeSorokin(img, 256);
                                                    break;
                                            }
                                            frames[i] = new GifFrame(new BitmapImage(img), { xOffset: x, yOffset: y, delayCentisecs: delay / 10 });
                                        }
                                        GifUtil.write(output, frames, { loops: webp.anim.loops })
                                            .then(() => {
                                                finalize(output);
                                            })
                                            .catch(reject);
                                    }
                                    catch (err) {
                                        reject(err);
                                    }
                                }
                                else {
                                    const { value: q = NaN, method: m = NaN, preset } = outputData.quality || {};
                                    const quality = !isNaN(q) ? q : undefined;
                                    const method = !isNaN(m) ? m : undefined;
                                    rotateAnim(outputData);
                                    const frames: Promise<void>[] = new Array(length);
                                    let w = 0,
                                        h = 0;
                                    for (let i = 0; i < length; ++i) {
                                        const { width, height, data: buffer } = items[i].handler.bitmap;
                                        frames[i] = webp.setFrameData(i, buffer, { width, height, quality, method, preset });
                                        w = Math.max(w, width);
                                        h = Math.max(h, height);
                                    }
                                    Promise.all(frames)
                                        .then(() => {
                                            webp.save(output, { width: w, height: h, bgColor: outputData.rotate ? [0, 0, 0, 0] : undefined })
                                                .then(() => {
                                                    finalize(output);
                                                })
                                                .catch(reject);
                                        })
                                        .catch(reject);
                                }
                            })
                            .catch(reject);
                        }
                        else {
                            resolve();
                        }
                        return true;
                    }
                    catch (err) {
                        if (WEBPMUX_INIT) {
                            this.writeFail([ERR_MESSAGE.UNKNOWN, 'node-webpmux'], err, { type: LOG_TYPE.IMAGE, startTime });
                        }
                        else if (this.checkPackage(err, 'node-webpmux@3', LOG_TYPE.IMAGE)) {
                            resolve();
                            return true;
                        }
                    }
                    return false;
                };
                const settings = this.settings;
                const { path: webp_path } = settings.webp ||= {};
                const bmpFile = getTempPath(this, 'bmp');
                try {
                    child_process.execFile(util.getWebP_bin('dwebp', webp_path), [util.normalizePath(localUri), '-bmp', '-o', util.normalizePath(bmpFile)], { shell: true, signal: this.signal, ...execOptions(settings) }, err => {
                        if (!err) {
                            transformBuffer(bmpFile);
                        }
                        else {
                            removeFile(bmpFile);
                            void tryWebpMux().then(valid => {
                                if (!valid) {
                                    reject(err);
                                }
                            });
                        }
                    });
                }
                catch (err) {
                    if (!await tryWebpMux()) {
                        if (this.checkPackage(err, 'dwebp-bin@1', LOG_TYPE.IMAGE)) {
                            resolve();
                        }
                        else {
                            reject(err);
                        }
                    }
                }
            }
            else {
                if (WorkerChannel.hasPermission(file) && this.parseWorker(outputData, outputType)) {
                    try {
                        let timer: NodeJS.Timeout | null = null;
                        const failed = (message: string) => {
                            reject(errorMessage(STRINGS.MODULE_NAME, message, localUri));
                        };
                        const outputOptions = getJPEGOptions(outputData.quality, output, outputType);
                        const worker = WORKER.jimp.sendObject({ data: file.buffer || localUri, commandData: outputData, outputType, output, outputOptions: outputOptions && { [mimeType]: outputOptions } } as WorkerMessage, [], (value: string | null) => {
                            if (timer) {
                                clearTimeout(timer);
                            }
                            if (value) {
                                finalize(value);
                            }
                            else {
                                failed(ERR_MESSAGE.WORKER);
                            }
                        });
                        if (worker) {
                            if (typeof file.worker === 'number') {
                                timer = setTimeout(() => {
                                    void worker.terminate();
                                    failed(ERR_MESSAGE.WORKER_TIMEOUT);
                                }, file.worker);
                            }
                            return;
                        }
                    }
                    catch (err) {
                        this.addLog(this.statusType.WARN, err, { source: 'worker' });
                    }
                }
                transformBuffer();
            }
        });
    }

    get settings(): JimpSettings {
        return this.module.settings ||= {};
    }
}

export = Jimp;