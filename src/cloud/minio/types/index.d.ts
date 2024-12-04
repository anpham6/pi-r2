import type { CloudStorage } from '@e-mc/types/lib/cloud';

import type { ClientOptions, Encryption, ReplicationConfig, TagList } from 'minio';

export interface CreateBucketV2Options {
    versioningConfig?: unknown;
    encryptionConfig?: Encryption;
    replicationConfig?: ReplicationConfig;
    tags?: TagList;
}

export type MinIOStorage = CloudStorage<MinIOStorageCredential, "minio">;
export type MinIOStorageCredential = Omit<ClientOptions, "credentialsProvider">;
export type MinIOPolicyType = "readonly" | "writeonly" | "readwrite";
export type S3PolicyType = "public-read";