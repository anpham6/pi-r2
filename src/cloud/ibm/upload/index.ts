import type { IModule } from '@e-mc/types/lib';

import type { UploadHost } from '@e-mc/cloud/types';

import type { IBMStorageCredential } from '../types';

import client = require('../client');

const aws = require('@pi-r/aws/upload') as UploadHost;

function upload(this: IModule, credential: IBMStorageCredential, service = 'ibm') {
    client.setStorageCredential(credential);
    return aws.call(this, credential, service, 'ibm-cos-sdk/clients/s3');
}

export = upload;