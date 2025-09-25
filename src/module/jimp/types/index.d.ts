import type { IFileManager, IHost, IImage, ImageConstructor } from '@e-mc/types/lib';
import type { ExternalAsset } from '@e-mc/types/lib/asset';
import type { WorkerMessage } from '@e-mc/types/lib/core';
import type { CommandData, CropData, Dimension, Point, ResizeData, RotateData, TransformOptions } from '@e-mc/types/lib/image';
import type { ImageModule, ImageSettings } from '@e-mc/types/lib/settings';
import type { ExecAction } from '@e-mc/types/lib/module';
import type { ImageHandler } from '@e-mc/image/types';

import type { JPEGOptions, JimpInstance } from 'jimp';

export interface JimpSettings extends ImageSettings {
    jimp?: {
        exec?: ExecAction;
        cache_expires?: number | string;
        rotate_clockwise?: boolean;
        gifwrap_quantize?: "dekker" | "sorokin" | "wu" | "none";
        worker?: {
            min?: number | string;
            max?: number | string;
            expires?: number | string;
        };
        options?: {
            decode?: Record<string, AnyObject>;
            encode?: Record<string, AnyObject>;
        };
    };
}

export interface JimpMessage<T = PlainObject> extends WorkerMessage<T, Buffer | string> {
    commandData: CommandData;
    outputType: string;
    output?: string;
}

export type ResultCallback<T = unknown, U = void, V = unknown> = (err: V, result: T) => U;

export interface IJimpHandler<T extends IHost = IHost, U extends ImageModule = ImageModule<JimpSettings>, V = JimpInstance> extends ImageHandler<V, T, IImage<T, U>, Promise<void>, Promise<void>> {
    rotate(localFile?: string, callback?: ResultCallback<string>): Promise<void>;
    background(value: number | [number, number, number, number]): void;
    finalize(output: string, callback?: (err: unknown, result: string) => void, replace?: boolean): Promise<void>;
}

export interface IJimpImage<T extends IFileManager<U>, U extends ExternalAsset = ExternalAsset, V extends ImageModule = ImageModule<JimpSettings>> extends IImage<T, V> {
    getEncodeOptions(): JPEGOptions | undefined;
}

export interface JimpImageConstructor<T extends IFileManager<U>, U extends ExternalAsset = ExternalAsset, V extends ImageModule = ImageModule<JimpSettings>> extends ConstructorDerived<ImageConstructor<T, V>> {
    transform<W extends TransformOptions>(file: string, command: string, options?: W): Promise<W extends { tempFile: true } ? string : Buffer | null>;
    applyBackground(instance: JimpInstance, data: { color: number }): void;
    applyResize(instance: JimpInstance, data: ResizeData): void;
    applyCrop(instance: JimpInstance, data: CropData): void;
    applyRotate(instance: JimpInstance, data: RotateData): void;
    applyMethod(instance: JimpInstance, name: string, ...args: unknown[]): unknown[];
    readonly prototype: IJimpImage<T, U, V>;
    new(module?: V, ...args: unknown[]): IJimpImage<T, U, V>;
}

export interface WebpMuxFrame extends Dimension, Point {
    delay: number;
}

export interface WebpMuxImage extends Readonly<Dimension> {
    readonly anim: { loops: number; bgColor: [number, number, number, number] };
    initLib(): Promise<void>;
    load(value: Bufferable): Promise<void>;
    demux(options: { path?: string; prefix?: string; buffers?: boolean }): Promise<void>;
    getImageData(): Promise<Uint8Array>;
    getFrameData(frame: number): Promise<Uint8Array>;
    setFrameData(frame: number, source: Buffer, options: Dimension & { preset?: string; quality?: number; exact?: boolean; lossless?: number; method?: number }): Promise<void>;
    save(path: string, options: Dimension & { bgColor?: number[] }): Promise<void>;
    get hasAnim(): boolean;
    get frames(): WebpMuxFrame[];
}

export interface WebpMux {
    Image: new() => WebpMuxImage;
}