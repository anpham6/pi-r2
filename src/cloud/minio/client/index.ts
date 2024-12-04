import type { IModule } from '@e-mc/types/lib';
import type { CloudStorage } from '@e-mc/types/lib/cloud';

import type { CreateBucketV2Options, MinIOPolicyType, MinIOStorageCredential, S3PolicyType } from '../types';

import type { BucketItem, Encryption, ReplicationConfigOpts, TagList } from 'minio';

import minio = require('minio');

import types = require('@e-mc/types');

import Cloud = require('@e-mc/cloud');

import { ERR_CLOUD, ERR_MESSAGE, SETTINGS_KEY_NAME as KEY_NAME, LOG_TYPE, VAL_CLOUD } from '@e-mc/types/constant';

export const enum MINIO {
    SERVICE = 'minio',
    REGION = 'us-east-1',
    SERVER = 'http://localhost:9000'
}

function createAWSPolicy(bucket: string, Sid: MinIOPolicyType | S3PolicyType) {
    const Resource = [`arn:aws:s3:::${bucket}/*`, `arn:aws:s3:::${bucket}`];
    let Action: string[];
    switch (Sid) {
        case 'readonly':
            Action = ["s3:GetBucketLocation", "s3:GetObject"];
            break;
        case 'writeonly':
            Action = ["s3:PutObject"];
            Resource.pop();
            break;
        case 'readwrite':
            Action = ["s3:GetBucketLocation", "s3:GetObject", "s3:PutObject"];
            break;
        case 'public-read':
            Action = ["s3:GetObject", "s3:GetObjectVersion"];
            Resource.pop();
            break;
    }
    return JSON.stringify({
        "Version": "2012-10-17",
        "Statement": [{
            "Sid": Sid,
            "Effect": "Allow",
            "Principal": {
                "AWS": ["*"]
            },
            "Action": Action,
            "Resource": Resource
        }]
    });
}

export function validateStorage(credential: MinIOStorageCredential, data?: CloudStorage) {
    let port = credential.port || 0;
    if (typeof port === 'string') {
        port = parseInt(port) || 0;
        credential.port = port;
    }
    if (Cloud.enabled(KEY_NAME.PROCESS_ENV_APPLY)) {
        credential.endPoint ||= process.env.MINIO_ENDPOINT!;
    }
    if (data) {
        const { bucket, upload } = data;
        if (upload && !upload.endpoint && bucket) {
            const { endPoint, useSSL } = credential;
            if (endPoint) {
                upload.endpoint = (useSSL === false ? 'http' : 'https') + '://' + endPoint + (port > 0 ? ':' + port : '') + '/' + bucket;
            }
        }
    }
    if (credential.accessKey && credential.secretKey) {
        return true;
    }
    if (Cloud.enabled(KEY_NAME.PROCESS_ENV_APPLY) && (credential.accessKey = process.env.MINIO_ACCESS_KEY!) && (credential.secretKey = process.env.MINIO_SECRET_KEY!)) {
        credential.sessionToken ||= process.env.MINIO_SESSION_TOKEN;
        return true;
    }
    return false;
}

export function createStorageClient(this: IModule, credential: MinIOStorageCredential) {
    credential.endPoint ||= 'localhost';
    return new minio.Client(credential);
}

export async function createBucket(this: IModule, credential: MinIOStorageCredential, bucketName: string, publicRead?: boolean) {
    return createBucketV2.call(this, credential, bucketName, publicRead ? 'public-read' : undefined);
}

export async function createBucketV2(this: IModule, credential: MinIOStorageCredential, bucketName: string, policy?: MinIOPolicyType | S3PolicyType, options?: CreateBucketV2Options) {
    const client = createStorageClient.call(this, credential);
    const errorBucket = (err: unknown) => {
        this.formatFail(LOG_TYPE.CLOUD, MINIO.SERVICE, [ERR_CLOUD.CREATE_BUCKET, bucketName], err, { ...Cloud.LOG_CLOUD_FAIL });
    };
    const finalizeBucket = () => {
        if (policy) {
            void setBucketPolicy.call(this, credential, bucketName, policy);
        }
        if (types.isPlainObject<CreateBucketV2Options>(options)) {
            const { tags, versioningConfig, encryptionConfig, replicationConfig } = options;
            const commandMessage = (feature: string) => {
                this.formatMessage(LOG_TYPE.CLOUD, MINIO.SERVICE, [VAL_CLOUD.CONFIGURE_BUCKET + ` (${feature})`, bucketName], null, { ...Cloud.LOG_CLOUD_COMMAND });
            };
            const errorMessage = (feature: string, err: unknown) => {
                this.formatFail(LOG_TYPE.CLOUD, MINIO.SERVICE, [ERR_CLOUD.CONFIGURE_BUCKET + ` (${feature})`, bucketName], err, { ...Cloud.LOG_CLOUD_FAIL, fatal: false });
            };
            if (types.isPlainObject<TagList>(tags)) {
                client.setBucketTagging(bucketName, tags)
                    .then(() => {
                        commandMessage('Tags');
                    })
                    .catch((err: unknown) => {
                        errorMessage('Tags', err);
                    });
            }
            if (versioningConfig) {
                client.setBucketVersioning(bucketName, versioningConfig)
                    .then(() => {
                        commandMessage('Versioning');
                    })
                    .catch((err: unknown) => {
                        errorMessage('Versioning', err);
                    });
            }
            if (types.isPlainObject<Encryption>(encryptionConfig)) {
                client.setBucketEncryption(bucketName, encryptionConfig)
                    .then(() => {
                        commandMessage('Encryption');
                    })
                    .catch((err: unknown) => {
                        errorMessage('Encryption', err);
                    });
            }
            if (types.isPlainObject<ReplicationConfigOpts>(replicationConfig)) {
                client.setBucketReplication(bucketName, replicationConfig)
                    .then(() => {
                        commandMessage('Replication');
                    })
                    .catch((err: unknown) => {
                        errorMessage('Replication', err);
                    });
            }
        }
    };
    return client.bucketExists(bucketName)
        .then(async exists => {
            if (!exists) {
                return client.makeBucket(bucketName, credential.region || MINIO.REGION)
                    .then(() => {
                        this.formatMessage(LOG_TYPE.CLOUD, MINIO.SERVICE, [VAL_CLOUD.CREATE_BUCKET, bucketName], '', { ...Cloud.LOG_CLOUD_COMMAND });
                        finalizeBucket();
                        return true;
                    })
                    .catch((err: unknown) => {
                        errorBucket(err);
                        return false;
                    });
            }
            finalizeBucket();
            return true;
        })
        .catch((err: unknown) => {
            errorBucket(err);
            return false;
        });
}

export async function setBucketPolicy(this: IModule, credential: MinIOStorageCredential, bucketName: string, bucketPolicy: string | AnyObject) {
    if (types.isObject(bucketPolicy)) {
        bucketPolicy = JSON.stringify(bucketPolicy);
    }
    if (!types.isString(bucketPolicy)) {
        this.formatMessage(LOG_TYPE.CLOUD, MINIO.SERVICE, [ERR_CLOUD.POLICY_INVALID, bucketName], null, { ...Cloud.LOG_CLOUD_WARN });
        return false;
    }
    const client = createStorageClient.call(this, credential);
    return client.bucketExists(bucketName)
        .then(async exists => {
            if (exists) {
                switch (bucketPolicy) {
                    case 'readonly':
                    case 'readwrite':
                    case 'writeonly':
                    case 'public-read':
                        bucketPolicy = createAWSPolicy(bucketName, bucketPolicy);
                        break;
                }
                return client.setBucketPolicy(bucketName, bucketPolicy as string)
                    .then(() => {
                        this.formatMessage(LOG_TYPE.CLOUD, MINIO.SERVICE, [VAL_CLOUD.POLICY_BUCKET, bucketName], null, { ...Cloud.LOG_CLOUD_COMMAND });
                        return true;
                    })
                    .catch((err: unknown) => {
                        this.formatFail(LOG_TYPE.CLOUD, MINIO.SERVICE, [ERR_CLOUD.POLICY_BUCKET, bucketName], err, { ...Cloud.LOG_CLOUD_FAIL, fatal: false });
                        return false;
                    });
            }
            return false;
        })
        .catch((err: unknown) => {
            this.formatFail(LOG_TYPE.CLOUD, MINIO.SERVICE, [ERR_MESSAGE.UNKNOWN, bucketName], err, { ...Cloud.LOG_CLOUD_FAIL, fatal: false });
            return false;
        });
}

export async function setBucketTagging(this: IModule, credential: MinIOStorageCredential, bucketName: string, tags: TagList) {
    if (!types.isPlainObject(tags)) {
        return false;
    }
    const client = createStorageClient.call(this, credential);
    const deleting = Object.keys(tags).length === 0;
    const command = () => {
        this.formatMessage(LOG_TYPE.CLOUD, MINIO.SERVICE, [deleting ? VAL_CLOUD.DELETE_TAG : VAL_CLOUD.CREATE_TAG, bucketName], null, { ...Cloud.LOG_CLOUD_COMMAND });
        return true;
    };
    const error = (err: unknown) => {
        this.formatFail(LOG_TYPE.CLOUD, MINIO.SERVICE, [ERR_CLOUD.TAGGING_BUCKET, bucketName], err, { ...Cloud.LOG_CLOUD_FAIL, fatal: false });
        return false;
    };
    return client.bucketExists(bucketName)
        .then(async exists => {
            if (exists) {
                if (deleting) {
                    return client.removeBucketTagging(bucketName).then(command).catch((err: unknown) => error(err));
                }
                return client.setBucketTagging(bucketName, tags).then(command).catch((err: unknown) => error(err));
            }
            return false;
        })
        .catch((err: unknown) => {
            this.formatFail(LOG_TYPE.CLOUD, MINIO.SERVICE, [ERR_MESSAGE.UNKNOWN, bucketName], err, { ...Cloud.LOG_CLOUD_FAIL, fatal: false });
            return false;
        });
}

export async function deleteObjects(this: IModule, credential: MinIOStorageCredential, bucketName: string) {
    return deleteObjectsV2.call(this, credential, bucketName, true);
}

export async function deleteObjectsV2(this: IModule, credential: MinIOStorageCredential, bucketName: string, recursive = true) {
    const client = createStorageClient.call(this, credential);
    return new Promise<void>((resolve, reject) => {
        client.bucketExists(bucketName)
            .then(exists => {
                if (exists) {
                    const stream = client.listObjectsV2(bucketName, '', recursive);
                    const items: BucketItem[] = [];
                    stream.on('data', item => {
                        items.push(item);
                    });
                    stream.on('end', () => {
                        client.removeObjects(bucketName, items.map(item => item.name!), err => {
                            if (!err) {
                                this.formatMessage(LOG_TYPE.CLOUD, MINIO.SERVICE, [VAL_CLOUD.EMPTY_BUCKET + ` (${items.length} files)`, bucketName], null, { ...Cloud.LOG_CLOUD_COMMAND });
                                resolve();
                            }
                            else {
                                reject(err);
                            }
                        });
                    });
                    stream.on('error', err => {
                        reject(err);
                    });
                }
                else {
                    resolve();
                }
            })
            .catch((err: unknown) => {
                reject(err);
            });
    });
}

export const CLOUD_UPLOAD_STREAM = true;