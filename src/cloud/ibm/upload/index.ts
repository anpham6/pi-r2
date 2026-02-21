import type { IModule } from '@e-mc/types/lib';

import type { IBMStorageCredential } from '../types';

import aws from '@pi-r/aws/upload';

import { setStorageCredential } from '../client';

function upload(this: IModule, credential: IBMStorageCredential, service = 'ibm') {
    setStorageCredential(credential);
    return aws.call(this, credential, service, 'ibm-cos-sdk/clients/s3');
}

export = upload;