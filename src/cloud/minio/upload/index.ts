import type { IModule } from '@e-mc/types/lib';
import type { UploadData } from '@e-mc/types/lib/cloud';
import type { ErrorCode } from '@e-mc/types/lib/node';

import type { UploadCallback } from '@e-mc/cloud/types';

import type { MinIOPolicyType, MinIOStorageCredential } from '../types';
import type { ObjectCannedACL } from '@pi-r/aws-lib/types';

import type { Readable } from 'stream';
import type { ItemBucketMetadata, LifecycleConfig, LockConfig } from 'minio';

import { LOG_TYPE, STATUS_TYPE, TRANSFER_TYPE, VAL_CLOUD } from '@e-mc/types/constant';

import path = require('node:path');
import fs = require('node:fs');
import crypto = require('node:crypto');
import stream = require('node:stream');

import Cloud = require('@e-mc/cloud');

import { createAbortError, isPlainObject } from '@e-mc/types';
import { createKeyAndBody, generateFilename } from '@e-mc/cloud/util';

import { MINIO } from '../client';

import client = require('../client');

const BUCKET_SESSION = new Set<string>();
const BUCKET_RESPONSE: ObjectMap<Promise<boolean>> = {};

const getBucketKey = (credential: unknown, bucket: string, acl = '') => Cloud.asString(credential, true) + bucket + '_' + acl;

function upload(this: IModule, credential: MinIOStorageCredential, service: string): UploadCallback {
    const minio = client.createStorageClient.call(this, credential);
    return async (data: UploadData<ItemBucketMetadata, ObjectCannedACL, unknown, MinIOPolicyType, LockConfig, unknown, LifecycleConfig>, callback) => {
        const { bucket: bucketName, localUri } = data;
        const { pathname, flags = 0, fileGroup, contentType, metadata = {}, tags, endpoint, active, acl, publicRead, admin = {}, overwrite, options } = data.upload;
        let filename = data.upload.filename || path.basename(localUri),
            bucketKey: string | undefined;
        const cleanup = () => {
            BUCKET_SESSION.delete(bucketName);
            if (bucketKey) {
                delete BUCKET_RESPONSE[bucketKey];
            }
        };
        const errorResponse = (err: unknown) => {
            cleanup();
            callback(err);
        };
        const addLog = (err: unknown) => this.addLog(STATUS_TYPE.WARN, err, service, bucketName);
        if (!BUCKET_SESSION.has(bucketName)) {
            const bucketAcl = admin.publicRead ? 'public-read' : admin.acl;
            const response = BUCKET_RESPONSE[bucketKey = getBucketKey(credential, bucketName, bucketAcl)] ||= client.createBucketV2.call(this, credential, bucketName, bucketAcl);
            if (!await response) {
                errorResponse(null);
                return;
            }
            BUCKET_SESSION.add(bucketName);
        }
        const configBucket = admin.configBucket;
        if (configBucket) {
            const { lifecycle, retentionPolicy } = configBucket;
            const commandMessage = (feature: string, message: unknown = null) => {
                this.formatMessage(LOG_TYPE.CLOUD, service, [VAL_CLOUD.CONFIGURE_BUCKET + ` (${feature})`, bucketName], { ...Cloud[message === 'delete' ? 'LOG_CLOUD_WARN' : 'LOG_CLOUD_COMMAND'] });
            };
            if (isPlainObject<LockConfig>(retentionPolicy)) {
                ((minio.setObjectLockConfig(bucketName, retentionPolicy) as unknown) as Promise<void>)
                    .then(() => {
                        commandMessage('Retention Policy', retentionPolicy.validity + ' ' + retentionPolicy.unit);
                    })
                    .catch(addLog);
            }
            if (lifecycle && Array.isArray(lifecycle.Rule)) {
                if (lifecycle.Rule.length === 0) {
                    minio.removeBucketLifecycle(bucketName)
                        .then(() => {
                            commandMessage('Lifecycle', 'delete');
                        })
                        .catch(addLog);
                }
                else {
                    minio.setBucketLifecycle(bucketName, lifecycle)
                        .then(() => {
                            commandMessage('Lifecycle');
                        })
                        .catch(addLog);
                }
            }
        }
        if (!overwrite) {
            const current = filename;
            const next = generateFilename(filename);
            let i = 0,
                exists: boolean | undefined;
            do {
                if (i > 0) {
                    [filename, exists] = next(i);
                    if (!exists) {
                        break;
                    }
                }
                exists = await minio.statObject(bucketName, Cloud.joinPath(pathname, filename))
                    .then(() => true)
                    .catch((err: unknown) => {
                        if (err instanceof Error && (err as ErrorCode).code !== 'NotFound') {
                            filename = crypto.randomUUID() + path.extname(current);
                            return true;
                        }
                        return false;
                    });
            }
            while (exists && ++i);
            if (i > 0) {
                this.formatMessage(LOG_TYPE.CLOUD, service, [VAL_CLOUD.RENAME_FILE, current], filename, { ...Cloud.LOG_CLOUD_WARN });
            }
        }
        const Key = [filename];
        const Body: Buffer[] = [];
        const Stream: Readable[] = [];
        const ContentType = [contentType];
        if (flags & TRANSFER_TYPE.STREAM) {
            try {
                Stream.push(data.buffer.length ? stream.Readable.from(data.buffer) : fs.createReadStream(localUri, { signal: this.signal }));
                if (fileGroup) {
                    const [key, body, type] = createKeyAndBody<Readable>(filename, fileGroup, 0, addLog, TRANSFER_TYPE.STREAM);
                    Key.push(...key);
                    Stream.push(...body);
                    ContentType.push(...type);
                }
            }
            catch (err) {
                errorResponse(err);
                return;
            }
        }
        else {
            Body.push(data.buffer);
            if (fileGroup) {
                const [key, body, type] = createKeyAndBody(filename, fileGroup, 0, addLog);
                Key.push(...key);
                Body.push(...body);
                ContentType.push(...type);
            }
        }
        for (let i = 0; i < Key.length; ++i) {
            const first = i === 0;
            if (this.aborted) {
                if (first) {
                    errorResponse(createAbortError());
                }
                return;
            }
            const objectName = Cloud.joinPath(pathname, Key[i], true);
            const type = ContentType[i] || Cloud.lookupMime(Key[i]) || 'application/octet-stream';
            const params: ItemBucketMetadata = first && metadata ? { ...metadata } : { ...options };
            const readable = publicRead || active && publicRead !== false && !acl;
            if (first) {
                params['Content-Type'] ||= type;
                if (readable) {
                    params['x-amz-acl'] = 'public-read';
                }
                else if (acl) {
                    params['x-amz-acl'] = acl;
                }
            }
            else {
                params['Content-Type'] = type;
                if (!params['x-amz-acl']) {
                    if (readable) {
                        params['x-amz-acl'] = 'public-read';
                    }
                    else if (acl) {
                        params['x-amz-acl'] = acl;
                    }
                }
            }
            minio.putObject(bucketName, objectName, Stream.length > 0 ? Stream[i] : Body[i], Stream.length > 0 ? undefined : Body[i].byteLength, params)
                .then(() => {
                    const url = Cloud.joinPath(endpoint || Cloud.joinPath(MINIO.SERVER, bucketName), objectName);
                    this.formatMessage(LOG_TYPE.CLOUD, service, VAL_CLOUD.UPLOAD_FILE, url, { ...Cloud.LOG_CLOUD_UPLOAD });
                    if (first) {
                        let length = -1;
                        if (isPlainObject(tags) && (length = Object.keys(tags).length) > 0) {
                            minio.setObjectTagging(bucketName, objectName, tags)
                                .then(() => {
                                    this.formatMessage(LOG_TYPE.CLOUD, service, [VAL_CLOUD.CREATE_TAG, bucketName], objectName, { ...Cloud.LOG_CLOUD_COMMAND });
                                })
                                .catch(addLog);
                        }
                        else if (tags === false || length === 0) {
                            minio.removeObjectTagging(bucketName, objectName, {} as { versionId: string })
                                .then(() => {
                                    this.formatMessage(LOG_TYPE.CLOUD, service, [VAL_CLOUD.DELETE_TAG, bucketName], objectName, { ...Cloud.LOG_CLOUD_COMMAND });
                                })
                                .catch(addLog);
                        }
                        cleanup();
                        callback(null, url);
                    }
                })
                .catch((err: unknown) => {
                    if (first) {
                        errorResponse(err);
                    }
                    else {
                        addLog(err);
                    }
                });
        }
    };
}

export = upload;