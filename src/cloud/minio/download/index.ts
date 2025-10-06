import type { IModule } from '@e-mc/types/lib';
import type { DownloadData } from '@e-mc/types/lib/cloud';

import type { DownloadCallback } from '@e-mc/cloud/types';

import type { MinIOStorageCredential } from '../types';

import type { RemoveOptions } from 'minio';

import Cloud = require('@e-mc/cloud');

import { ERR_CLOUD, LOG_TYPE, VAL_CLOUD } from '@e-mc/types/constant';

import { errorValue, isPlainObject } from '@e-mc/types';
import { readableAsBuffer } from '@e-mc/cloud/util';

import client = require('../client');

function download(this: IModule, credential: MinIOStorageCredential, service: string): DownloadCallback {
    const minio = client.createStorageClient.call(this, credential);
    return (data: DownloadData<RemoveOptions>, callback) => {
        const { bucket: bucketName, download: target } = data;
        const filename = target.keyname || target.filename;
        if (!bucketName || !filename) {
            callback(errorValue('Missing property', !bucketName ? 'Bucket' : 'Key'));
            return;
        }
        minio.getObject(bucketName, filename, { versionId: target.versionId })
            .then(result => {
                readableAsBuffer(result).then(buffer => {
                    callback(null, buffer);
                    const deleteObject = target.deleteObject;
                    if (deleteObject) {
                        const location = Cloud.joinPath(bucketName, filename);
                        minio.removeObject(bucketName, filename, isPlainObject(deleteObject) ? deleteObject : { versionId: target.versionId })
                            .then(() => {
                                this.formatMessage(LOG_TYPE.CLOUD, service, VAL_CLOUD.DELETE_FILE, location, Cloud.optionsLogMessage('DELETE'));
                            })
                            .catch((err: unknown) => {
                                this.formatFail(LOG_TYPE.CLOUD, service, [ERR_CLOUD.DELETE_FAIL, location], err, Cloud.optionsLogMessage('FAIL', { fatal: !!target.active }));
                            });
                    }
                })
                .catch(callback);
            })
            .catch(callback);
    };
}

export = download;