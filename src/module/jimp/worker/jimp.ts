import type { JimpMessage } from '../types';

import type { MessagePort } from 'node:worker_threads';
import type { JPEGOptions, JimpInstance } from 'jimp';

import { parentPort, workerData } from 'node:worker_threads';
import { Jimp } from 'jimp';

import { ERR_MESSAGE } from '@e-mc/types/constant';

import Image = require('@e-mc/image');

import { errorMessage, isString } from '@e-mc/types';

import JimpApp = require('@pi-r/jimp');

const PORT: MessagePort = workerData[0];

parentPort!.on('message', (value: JimpMessage<JPEGOptions>) => {
    const { data, commandData, output, options } = value;
    Jimp.read(typeof data === 'string' ? data : Image.asBuffer(data))
        .then(async img => {
            const { method, resize, crop, rotate, opacity = -1 } = commandData;
            if (method) {
                for (const [name, args = []] of method) {
                    if (name === 'composite') {
                        const [src, x, y, opts] = args;
                        if (isString(src) && typeof x === 'number' && typeof y === 'number') {
                            img.composite(await Jimp.read(src), x, y, opts as PlainObject);
                        }
                        else {
                            throw errorMessage(name, ERR_MESSAGE.PARAMETERS, JSON.stringify(value));
                        }
                    }
                    else {
                        JimpApp.applyMethod(img as JimpInstance, name, ...args);
                    }
                }
            }
            if (resize) {
                JimpApp.applyResize(img as JimpInstance, resize);
            }
            if (crop) {
                JimpApp.applyCrop(img as JimpInstance, crop);
            }
            if (rotate) {
                JimpApp.applyRotate(img as JimpInstance, rotate);
            }
            if (opacity >= 0) {
                img.opacity(opacity);
            }
            if (output) {
                img.write(output as "jimp.jpg", options)
                    .then(() => {
                        PORT.postMessage(output);
                    })
                    .catch((err: unknown) => {
                        console.error(err);
                        PORT.postMessage(null);
                    });
            }
            else {
                void img.getBuffer(value.outputType as "image/jpeg", options)
                    .then(result => {
                        PORT.postMessage(result, [result.buffer as ArrayBuffer]);
                    });
            }
        })
        .catch((err: unknown) => {
            console.error(err);
            PORT.postMessage(null);
        });
});