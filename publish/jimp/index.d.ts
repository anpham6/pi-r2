import type { IFileManager } from '@e-mc/types/lib';

import type { JimpImageConstructor } from './types';

declare const Jimp: JimpImageConstructor<IFileManager>;

export = Jimp;