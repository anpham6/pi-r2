import type { ICloud, IModule } from '@e-mc/types/lib';
import type { BucketWebsiteOptions, CloudDatabase } from '@e-mc/types/lib/cloud';
import type { CacheOptions } from '@e-mc/types/lib/core';
import type { BatchQueryResult } from '@e-mc/types/lib/db';

import type { IBMDatabaseCredential, IBMDatabaseQuery, IBMStorageCredential, PostAll } from '../types';
import type { ConfigureBucketOptions } from '@pi-r/aws/types';
import type { BucketCannedACL } from '@pi-r/aws-lib/types';

import type { S3 } from 'ibm-cos-sdk';
import type { AuthenticatorInterface } from 'ibm-cloud-sdk-core';
import type { Document, PostPartitionAllDocsParams, PostPartitionFindParams } from '@ibm-cloud/cloudant/cloudant/v1';

import { ERR_DB, ERR_MESSAGE, STATUS_TYPE } from '@e-mc/types/constant';
import { HTTP_STATUS } from '@e-mc/types/lib/http';

import ibm = require('ibm-cloud-sdk-core');
import cloudant = require('@ibm-cloud/cloudant');
import cloudant_v1 = require('@ibm-cloud/cloudant/cloudant/v1');
import aws = require('@pi-r/aws');

import Cloud = require('@e-mc/cloud');

import { isArray, isString } from '@e-mc/types';
import { formatError } from '@e-mc/cloud/util';

const enum STRINGS {
    SERVICE = 'ibm',
    SDK = 'ibm-cos-sdk/clients/s3',
    CLOUDANT = 'CLOUDANT'
}

export function validateStorage(credential: IBMStorageCredential) {
    return !!(credential.apiKeyId && credential.serviceInstanceId && (credential.region || credential.endpoint));
}

export function validateDatabase(credential: IBMDatabaseCredential, data: CloudDatabase) {
    if (credential.url && (credential.username && credential.password || credential.apikey || credential.bearerToken) || credential.iamProfileName || credential.iamProfileCrn || credential.iamProfileId && credential.authType) {
        return true;
    }
    const env = process.env;
    const serviceName = credential.serviceName || STRINGS.CLOUDANT;
    const hasEnv = (attr: string, value?: string) => !value ? isString(env[serviceName + '_' + attr]) : value === env[serviceName + '_' + attr];
    switch (env[serviceName + '_AUTH_TYPE']?.toLowerCase()) {
        case 'container':
            return hasEnv('IAM_PROFILE_NAME');
        case 'vpc':
            return hasEnv('IAM_PROFILE_CRN');
        case 'mcsp':
            return hasEnv('APIKEY') && hasEnv('AUTH_URL');
        case 'cp4d':
            return hasEnv('USERNAME') && hasEnv('APIKEY') && hasEnv('URL');
        default:
            return hasEnv('URL') && (hasEnv('APIKEY') || hasEnv('IAM_PROFILE_ID') || hasEnv('BEARER_TOKEN') || hasEnv('USERNAME') && hasEnv('PASSWORD'));
    }
}

export function setStorageCredential(credential: IBMStorageCredential) {
    const { endpoint, region } = credential;
    if (endpoint) {
        credential.region ||= /([^.]+)\.cloud-object-storage\.appdomain\.cloud\b/i.exec(endpoint)?.[1];
    }
    else if (region) {
        credential.endpoint ||= `https://s3.${region}.cloud-object-storage.appdomain.cloud`;
    }
    credential.ibmAuthEndpoint = 'https://iam.cloud.ibm.com/identity/token';
    credential.signatureVersion = 'iam';
}

export function createDatabaseClient(this: IModule, credential: IBMDatabaseCredential) {
    const { url, username, password, apikey, authType, authUrl } = credential;
    let authenticator: AuthenticatorInterface | undefined;
    if (apikey) {
        const { clientId, clientSecret, scope, disableSslVerification, headers } = credential;
        switch (authType) {
            case 'mcsp':
                if (authUrl) {
                    authenticator = new ibm.McspAuthenticator({ apikey, url: authUrl, disableSslVerification, headers });
                }
                break;
            case 'cp4d':
                if (username && authUrl) {
                    authenticator = new ibm.CloudPakForDataAuthenticator({ apikey, username, url: authUrl, disableSslVerification, headers });
                }
                break;
            default:
                authenticator = new ibm.IamAuthenticator(Object.assign(clientId && clientSecret ? { clientId, clientSecret } : {}, { apikey, scope, url: authUrl, disableSslVerification, headers }));
                break;
        }
    }
    else if (username && password) {
        switch (authType) {
            case 'couchdb':
                authenticator = new cloudant.CouchdbSessionAuthenticator({ username, password });
                break;
            case 'cp4d':
                if (authUrl) {
                    authenticator = new ibm.CloudPakForDataAuthenticator({ username, password, url: authUrl, disableSslVerification: credential.disableSslVerification, headers: credential.headers });
                }
                break;
            default:
                authenticator = new ibm.BasicAuthenticator({ username, password });
                credential.serviceName ||= STRINGS.CLOUDANT;
                break;
        }
    }
    else if (credential.bearerToken) {
        authenticator = new ibm.BearerTokenAuthenticator({ bearerToken: credential.bearerToken });
    }
    else if (credential.iamProfileName || authType === 'container' && credential.iamProfileId) {
        const { iamProfileName, iamProfileId, crTokenFilename, clientId, clientSecret, scope, disableSslVerification, headers } = credential;
        authenticator = new ibm.ContainerAuthenticator(Object.assign(clientId && clientSecret ? { clientId, clientSecret } : {}, { iamProfileName, iamProfileId, crTokenFilename, scope, url: authUrl, disableSslVerification, headers }));
    }
    else if (credential.iamProfileCrn || authType === 'vpc' && credential.iamProfileId) {
        const { iamProfileCrn, iamProfileId } = credential;
        authenticator = new ibm.VpcInstanceAuthenticator({ iamProfileCrn, iamProfileId, url: authUrl });
    }
    const instance = cloudant_v1.newInstance(authenticator ? { ...credential, authenticator } : (credential.serviceName ||= STRINGS.CLOUDANT, credential));
    if (url) {
        instance.setServiceUrl(url);
    }
    return instance;
}

export async function createBucket(this: IModule, credential: IBMStorageCredential, bucket: string, publicRead?: boolean) {
    return createBucketV2.call(this, credential, bucket, publicRead ? 'public-read' : undefined);
}

export async function createBucketV2(this: IModule, credential: IBMStorageCredential, bucket: string, ACL?: BucketCannedACL, options?: S3.CreateBucketRequest) {
    return aws.createBucketV2.call(this, credential, bucket, ACL, options, STRINGS.SERVICE, STRINGS.SDK);
}

export async function setBucketPolicy(this: IModule, credential: IBMStorageCredential, bucket: string, options: ConfigureBucketOptions) {
    return aws.setBucketPolicy.call(this, credential, bucket, options, STRINGS.SERVICE, STRINGS.SDK);
}

export async function setBucketWebsite(this: IModule, credential: IBMStorageCredential, bucket: string, options: BucketWebsiteOptions) {
    return aws.setBucketWebsite.call(this, credential, bucket, options, STRINGS.SERVICE, STRINGS.SDK);
}

export async function deleteObjects(this: IModule, credential: IBMStorageCredential, Bucket: string, service?: string, sdk?: string, recursive = true) {
    return deleteObjectsV2.call(this, credential, Bucket, recursive);
}

export async function deleteObjectsV2(this: IModule, credential: IBMStorageCredential, Bucket: string, recursive = true) {
    return deleteObjectsV3.call(this, credential, Bucket, { recursive, Bucket });
}

export async function deleteObjectsV3(this: IModule, credential: IBMStorageCredential, bucket: string, options = {} as aws.ListObjectsRequest) {
    setStorageCredential(credential);
    return aws.deleteObjectsV3.call(this, credential, bucket, options, STRINGS.SERVICE, STRINGS.SDK);
}

export async function executeQuery(this: ICloud, credential: IBMDatabaseCredential, data: IBMDatabaseQuery, sessionKey?: string) {
    return (await executeBatchQuery.call(this, credential, [data], sessionKey))[0] || [];
}

export async function executeBatchQuery(this: ICloud, credential: IBMDatabaseCredential, batch: IBMDatabaseQuery[], sessionKey?: string) {
    const length = batch.length;
    const result: BatchQueryResult = new Array(length);
    const caching = length > 0 && this.hasCache(batch[0].service, sessionKey);
    const cacheValue = { value: this.valueOfKey(credential, 'cache'), sessionKey } as CacheOptions;
    let client: cloudant_v1 | undefined;
    const createClient = () => client ||= createDatabaseClient.call(this, credential);
    for (let i = 0; i < length; ++i) {
        const item = batch[i];
        const { service, name, table, id: docId, query, partitionKey, limit = 0, update, ignoreCache } = item;
        const db = name || table;
        const useCache = caching && ignoreCache !== true;
        cacheValue.exclusiveOf = Array.isArray(ignoreCache) ? ignoreCache : undefined;
        let rows: unknown[] | undefined,
            queryString = '';
        if (db && docId) {
            if (useCache) {
                queryString = db + '_' + docId;
                if (!update && (rows = this.getCacheResult(service, credential, queryString, cacheValue, ignoreCache))) {
                    result[i] = rows;
                    continue;
                }
            }
            client = createClient();
            let { status, result: document } = await client.getDocument({ db, docId });
            if (status === HTTP_STATUS.OK) {
                rows = [document];
            }
            if (update) {
                let _rev: string | undefined;
                const current = update.document as Document | undefined;
                const failed = (message: string, fatal?: boolean) => {
                    if (fatal) {
                        item.transactionFail = true;
                    }
                    else {
                        delete item.update;
                    }
                    this.addLog(STATUS_TYPE.WARN, message + ` (_id=${docId};_rev=${_rev || ERR_MESSAGE.UNKNOWN})`, service, 'getDocument');
                };
                if (current) {
                    _rev = current._rev;
                    if (rows) {
                        try {
                            _rev = document._rev;
                            update.db = db;
                            update.document = { ...document as PlainObject, ...current as PlainObject, _id: docId, _rev };
                            ({ status } = await client.postDocument(update));
                            if (status === HTTP_STATUS.OK || status === HTTP_STATUS.ACCEPTED) {
                                ({ status, result: document } = await client.getDocument({ db, docId }));
                                if (status === HTTP_STATUS.OK) {
                                    rows = [document];
                                }
                                else {
                                    failed('Update success (GET failed)');
                                }
                            }
                            else {
                                failed('Update failed');
                            }
                        }
                        catch {
                            failed('Update failed');
                        }
                    }
                    else {
                        failed('Row does not exist', true);
                    }
                }
                else {
                    failed('Document is missing');
                }
            }
        }
        else if (query) {
            if (db) {
                query.db = db;
            }
            else if (!query.db) {
                throw formatError(item, ERR_DB.NAME);
            }
            if (!('queries' in query)) {
                if (partitionKey) {
                    (query as PostPartitionFindParams).partitionKey = partitionKey;
                }
                if (limit > 0) {
                    query.limit = limit;
                }
                if (!('selector' in query)) {
                    query.includeDocs = true;
                }
            }
            if (useCache && (rows = this.getCacheResult(service, credential, queryString = Cloud.asString(query, true), cacheValue, ignoreCache))) {
                result[i] = rows;
                continue;
            }
            client = createClient();
            if ('selector' in query) {
                const { status, result: document } = 'partitionKey' in query ? await client.postPartitionFind(query) : await client.postFind(query);
                if (status === HTTP_STATUS.OK) {
                    rows = document.docs;
                }
            }
            else if ('view' in query) {
                if ('queries' in query) {
                    const { status, result: document } = await client.postViewQueries(query);
                    if (status === HTTP_STATUS.OK) {
                        rows = document.results;
                    }
                }
                else {
                    const { status, result: document } = 'partitionKey' in query ? await client.postPartitionView(query) : await client.postView(query);
                    if (status === HTTP_STATUS.OK) {
                        rows = document.rows?.map(row => isArray(row.value) ? row.value : row.doc || []);
                    }
                }
            }
            else {
                const { status, result: document } = 'partitionKey' in query ? await client.postPartitionSearch(query) : await client.postSearch(query);
                if (status === HTTP_STATUS.OK) {
                    rows = document.rows?.map(row => row.doc);
                }
            }
        }
        else if (item.params || partitionKey) {
            const params = (item.params || {}) as PostAll;
            if (db) {
                params.db = db;
            }
            else if (!params.db) {
                throw formatError(item, ERR_DB.NAME);
            }
            if (!('docs' in params) && !('queries' in params) && !('selector' in params)) {
                if (partitionKey) {
                    (params as PostPartitionAllDocsParams).partitionKey = partitionKey;
                }
                params.includeDocs = true;
                if (limit > 0) {
                    params.limit = limit;
                }
            }
            if (useCache && (rows = this.getCacheResult(service, credential, queryString = Cloud.asString(params, true), cacheValue, ignoreCache))) {
                result[i] = rows;
                continue;
            }
            client = createClient();
            if ('partitionKey' in params) {
                const { status, result: document } = await client.postPartitionAllDocs(params);
                if (status === HTTP_STATUS.OK) {
                    rows = document.rows?.map(row => row.doc || row.value);
                }
            }
            else if ('docs' in params) {
                const { status, result: document } = await client.postBulkGet(params);
                if (status === HTTP_STATUS.OK) {
                    rows = document.results;
                }
            }
            else if ('queries' in params) {
                const { status, result: document } = await client.postAllDocsQueries(params);
                if (status === HTTP_STATUS.OK) {
                    rows = document.results;
                }
            }
            else if ('selector' in params) {
                const { status, result: document } = await client.postExplain(params);
                if (status === HTTP_STATUS.OK) {
                    rows = [document];
                }
            }
            else {
                const { status, result: document } = await client.postAllDocs(params);
                if (status === HTTP_STATUS.OK) {
                    rows = document.rows?.map(row => row.doc || row.value);
                }
            }
        }
        else {
            throw formatError(item, !db ? ERR_DB.NAME : ERR_DB.QUERY);
        }
        result[i] = this.setQueryResult(service, credential, queryString, rows, cacheValue);
    }
    return result;
}