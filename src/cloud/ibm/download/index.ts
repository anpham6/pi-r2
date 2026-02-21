import type { IModule } from '@e-mc/types/lib';

import type { DownloadCallback } from '@e-mc/cloud/types';

import type { IBMStorageCredential } from '../types';

import aws from '@pi-r/aws/download';

import { setStorageCredential } from '../client';

function download(this: IModule, credential: IBMStorageCredential, service = 'ibm'): DownloadCallback {
    setStorageCredential(credential);
    return aws.call(this, credential, service, 'ibm-cos-sdk/clients/s3');
}

export = download;