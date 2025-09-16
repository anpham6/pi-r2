import type { JimpMessage } from '../types';

import type { MessagePort } from 'node:worker_threads';
import type { JPEGOptions, JimpInstance } from 'jimp';

import { parentPort, workerData } from 'node:worker_threads';
import { Jimp } from 'jimp';

import jimp = require('@pi-r/jimp');

import Image = require('@e-mc/image');

const PORT: MessagePort = workerData[0];

parentPort!.on('message', (value: JimpMessage<JPEGOptions>) => {
    const { data, commandData, output, options } = value;
    Jimp.read(typeof data === 'string' ? data : Image.asBuffer(data))
        .then(async img => {
            const { method, resize, crop, rotate, opacity = -1 } = commandData;
            if (method) {
                for (const [name, args = []] of method) {
                    jimp.applyMethod(img as JimpInstance, name, ...args);
                }
            }
            if (resize) {
                jimp.applyResize(img as JimpInstance, resize);
            }
            if (crop) {
                jimp.applyCrop(img as JimpInstance, crop);
            }
            if (rotate) {
                jimp.applyRotate(img as JimpInstance, rotate);
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