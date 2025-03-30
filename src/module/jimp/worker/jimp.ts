import type { WorkerMessage } from '../types';

import type { MessagePort } from 'node:worker_threads';
import type { JPEGOptions, JimpInstance } from 'jimp';

import { parentPort, workerData } from 'node:worker_threads';
import { Jimp } from 'jimp';

import Image = require('@e-mc/image');

import Jimp2 = require('@pi-r2/jimp');

const PORT: MessagePort = workerData[0];

parentPort!.on('message', (value: WorkerMessage<JPEGOptions>) => {
    const { data, commandData, outputType, output, outputOptions } = value;
    Jimp.read(typeof data === 'string' ? data : Image.asBuffer(data))
        .then(img => {
            const { method, resize, crop, rotate, opacity = -1 } = commandData;
            if (method) {
                for (const [name] of method) {
                    img[name as "sepia"]();
                }
            }
            if (resize) {
                Jimp2.applyResize(img as JimpInstance, resize);
            }
            if (crop) {
                Jimp2.applyCrop(img as JimpInstance, crop);
            }
            if (rotate) {
                Jimp2.applyRotate(img as JimpInstance, rotate);
            }
            if (opacity >= 0) {
                img.opacity(opacity);
            }
            if (output) {
                img.write(output as "jimp.jpg", outputOptions)
                    .then(() => {
                        PORT.postMessage(output);
                    })
                    .catch((err: unknown) => {
                        console.error(err);
                        PORT.postMessage(null);
                    });
            }
            else {
                void img.getBuffer(outputType as "image/jpeg", outputOptions)
                    .then(result => {
                        PORT.postMessage(result, [result.buffer]);
                    });
            }
        })
        .catch((err: unknown) => {
            console.error(err);
            PORT.postMessage(null);
        });
});