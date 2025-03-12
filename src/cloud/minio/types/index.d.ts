import type { CloudStorage } from '@e-mc/types/lib/cloud';

import type { ClientOptions, ReplicationConfigOpts, TagList } from 'minio';

/** MINIO INTERNAL **/
type ApplySSEByDefault = {
    KmsMasterKeyID?: string;
    SSEAlgorithm: string;
};
type EncryptionRule = {
    ApplyServerSideEncryptionByDefault?: ApplySSEByDefault;
};
type ExcludedPrefix = {
    Prefix: string;
};
type VersioningEnabled = 'Enabled';
type VersioningSuspended = 'Suspended';
type EncryptionConfig = {
    Rule: EncryptionRule[];
};
type BucketVersioningConfiguration = {
    Status: VersioningEnabled | VersioningSuspended;
    MFADelete?: string;
    ExcludedPrefixes?: ExcludedPrefix[];
    ExcludeFolders?: boolean;
};
/** MINIO INTERNAL **/

export interface CreateBucketV2Options {
    versioningConfig?: BucketVersioningConfiguration;
    encryptionConfig?: EncryptionConfig;
    replicationConfig?: ReplicationConfigOpts;
    tags?: TagList;
}

export type MinIOStorage = CloudStorage<MinIOStorageCredential, "minio">;
export type MinIOStorageCredential = Omit<ClientOptions, "credentialsProvider">;
export type MinIOPolicyType = "readonly" | "writeonly" | "readwrite";
export type S3PolicyType = "public-read";