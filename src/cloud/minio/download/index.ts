import type { IModule } from '@e-mc/types/lib';
import type { DownloadData } from '@e-mc/types/lib/cloud';

import type { DownloadCallback } from '@e-mc/cloud/types';

import type { MinIOStorageCredential } from '../types';

import type { NoResultCallback, RemoveOptions } from 'minio';
import type { Readable } from 'stream';

import types = require('@e-mc/types');

import Cloud = require('@e-mc/cloud');

import { ERR_CLOUD, LOG_TYPE, VAL_CLOUD } from '@e-mc/types/constant';

import util = require('@e-mc/cloud/util');

import client = require('../client');

type ResultCallback<T> = (error: Error | null, result: T) => void;
type GetObject = (bucketName: string, objectName: string, getOpts: AnyObject, cb: ResultCallback<Readable>) => void;
type RemoveObject = (bucketName: string, objectName: string, removeOpts: AnyObject, cb: NoResultCallback) => void;

export = function download(this: IModule, credential: MinIOStorageCredential, service: string): DownloadCallback {
    const minio = client.createStorageClient.call(this, credential);
    return (data: DownloadData<RemoveOptions>, callback) => {
        const { bucket: bucketName, download: target } = data;
        const filename = target.keyname || target.filename;
        if (!bucketName || !filename) {
            callback(types.errorValue('Missing property', !bucketName ? 'Bucket' : 'Key'));
            return;
        }
        (minio.getObject as GetObject)(bucketName, filename, { versionId: target.versionId }, (err, result) => {
            if (!err) {
                util.readableAsBuffer(result).then(buffer => {
                    callback(null, buffer);
                }).catch((error: unknown) => {
                    callback(error);
                });
                const deleteObject = target.deleteObject;
                if (deleteObject) {
                    (minio.removeObject as RemoveObject)(bucketName, filename, types.isPlainObject(deleteObject) ? deleteObject : { versionId: target.versionId }, error => {
                        const location = Cloud.joinPath(bucketName, filename);
                        if (!error) {
                            this.formatMessage(LOG_TYPE.CLOUD, service, VAL_CLOUD.DELETE_FILE, location, { ...Cloud.LOG_CLOUD_DELETE });
                        }
                        else {
                            this.formatFail(LOG_TYPE.CLOUD, service, [ERR_CLOUD.DELETE_FAIL, location], error, { ...Cloud.LOG_CLOUD_FAIL, fatal: !!target.active });
                        }
                    });
                }
            }
            else {
                callback(err);
            }
        });
    };
};