import type { IFileManager, IHost, IImage, ImageConstructor } from '@e-mc/types/lib';
import type { ExternalAsset } from '@e-mc/types/lib/asset';
import type { TransformOptions } from '@e-mc/types/lib/image';
import type { ImageModule, ImageSettings } from '@e-mc/types/lib/settings';
import type { ExecAction } from '@e-mc/types/lib/module';

import type { ImageHandler } from '@e-mc/image/types';

import type { JimpInstance } from 'jimp';

export interface JimpSettings extends ImageSettings {
    jimp?: {
        exec?: ExecAction;
        cache_expires?: number | string;
        rotate_clockwise?: boolean;
        gifwrap_quantize?: "dekker" | "sorokin" | "wu" | "none";
        read_options?: ObjectMap<AnyObject>;
    };
}

export type ResultCallback<T = unknown, U = void, V = unknown> = (err: V, result: T) => U;

export interface IJimpHandler<T extends IHost = IHost, U extends ImageModule = ImageModule<JimpSettings>, V = JimpInstance> extends ImageHandler<V, T, IImage<T, U>, Promise<void>> {
    outFile: string;
    method(): Promise<void>;
    rotate(localFile?: string, callback?: ResultCallback<string>): Promise<this>;
    background(value: number | [number, number, number, number]): void;
}

export interface JimpImageConstructor<T extends IFileManager<U>, U extends ExternalAsset = ExternalAsset, V extends ImageModule = ImageModule<JimpSettings>> extends ConstructorDerived<ImageConstructor<T, V>> {
    transform<W extends TransformOptions>(file: string, command: string, options?: W): Promise<W extends { tempFile: true } ? string : Buffer | null>;
    readonly prototype: IImage<T, V>;
    new(module?: V, ...args: unknown[]): IImage<T, V>;
}