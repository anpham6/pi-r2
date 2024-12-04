import type { IModule } from '@e-mc/types/lib';

import type { DownloadCallback, DownloadHost } from '@e-mc/cloud/types';

import type { IBMStorageCredential } from '../types';

import client = require('../client');

const aws = require('@pi-r/aws/download') as DownloadHost;

function download(this: IModule, credential: IBMStorageCredential, service = 'ibm'): DownloadCallback {
    client.setStorageCredential(credential);
    return aws.call(this, credential, service, 'ibm-cos-sdk/clients/s3');
}

export = download;