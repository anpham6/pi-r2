import type { CloudDatabase, CloudStorage } from '@e-mc/types/lib/cloud';
import type { AuthValue } from '@e-mc/types/lib/http';

import type { UserOptions } from 'ibm-cloud-sdk-core';
import type { PostAllDocsParams, PostAllDocsQueriesParams, PostBulkGetParams, PostDocumentParams, PostExplainParams, PostFindParams, PostPartitionAllDocsParams, PostPartitionFindParams, PostPartitionSearchParams, PostPartitionViewParams, PostSearchParams, PostViewParams, PostViewQueriesParams } from '@ibm-cloud/cloudant/cloudant/v1';
import type { ConfigurationOptions } from 'ibm-cos-sdk/lib/config-base';
import type { Options as BearerTokenOptions } from 'ibm-cloud-sdk-core/auth/authenticators/bearer-token-authenticator';
import type { Options as ContainerOptions } from 'ibm-cloud-sdk-core/auth/authenticators/container-authenticator';
import type { Options as IamOptions } from 'ibm-cloud-sdk-core/auth/authenticators/iam-authenticator';
import type { Options as VpcOptions } from 'ibm-cloud-sdk-core/auth/authenticators/vpc-instance-authenticator';

export type IBMStorage = CloudStorage<IBMStorageCredential, "ibm">;

export interface IBMStorageCredential extends ConfigurationOptions {
    endpoint?: string;
}

export interface IBMDatabaseQuery extends CloudDatabase<PostFind | PostSearch | PostView, PlainObject, PostDocumentParams, PostDocumentParams | PostAll, IBMDatabaseCredential> {
    source: "cloud";
    service: "ibm";
    partitionKey?: string;
}

export interface IBMDatabaseCredential extends AuthValue, UserOptions, Partial<IamOptions>, ContainerOptions, VpcOptions, BearerTokenOptions {
    authType?: "basic" | "iam" | "bearertoken" | "container" | "vpc" | "mcsp" | "cp4d" | "couchdb";
    authUrl?: string;
}

export type PostFind = PostFindParams | PostPartitionFindParams;
export type PostSearch = PostSearchParams | PostPartitionSearchParams;
export type PostView = PostViewParams | PostViewQueriesParams | PostPartitionViewParams;
export type PostAll = PostAllDocsParams | PostAllDocsQueriesParams | PostPartitionAllDocsParams | PostBulkGetParams | PostExplainParams;