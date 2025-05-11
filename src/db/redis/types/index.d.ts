import type { DbDataSource } from '@e-mc/types/lib/squared';

import type { IdentifierAction } from '@e-mc/types/lib/core';
import type { CascadeAction, ServerAuth } from '@e-mc/types/lib/db';
import type { AuthValue } from '@e-mc/types/lib/http';

import type { RedisClientOptions } from '@redis/client';
import type { RedisJSON } from '@redis/json/dist/lib/commands';
import type { RedisArgument } from '@redis/client/dist/lib/RESP/types';
import type { CommandOptions } from '@redis/client/dist/lib/client/commands-queue';
import type { ScanOptions } from '@redis/client/dist/lib/commands/SCAN';
import type { FtAggregateOptions } from '@redis/search/dist/lib/commands/AGGREGATE';
import type { FtSearchOptions } from '@redis/search/dist/lib/commands/SEARCH';
import type { JsonGetOptions } from '@redis/json/dist/lib/commands/GET';
import type { RedisClientPoolType as IRedisClientPoolType, RediSearchSchema, RedisDefaultModules, RedisModules, SetOptions } from 'redis';

export interface RedisDataSource extends DbDataSource<string, PlainObject, RedisSetValue | RedisSetValue[] | RedisJSONValue | RedisJSONValue[], RedisCredential, string>, CascadeAction, AuthValue {
    source: "redis";
    key?: RedisArgument | RedisArgument[];
    field?: RedisArgument | string[];
    path?: string;
    format?: RedisFormat | "HKEYS" | "HVALS" | "HSCAN";
    search?: RedisQuery;
    aggregate?: RedisQuery;
    cursor?: RedisArgument | RedisArgument[] | number | number[];
    iterations?: number | number[];
    options?: {
        client?: RedisClientOptions;
        /** @deprecated RedisClientOptions.commandOptions */
        command?: CommandOptions;
        get?: JsonGetOptions;
        search?: FtSearchOptions;
        aggregate?: FtAggregateOptions;
        scan?: ScanOptions;
    };
    database?: number;
}

export type RedisCredential = ServerAuth;

export interface RedisCommand<T = "HASH" | "JSON" | undefined, U = unknown, V = unknown> {
    format: T;
    command?: string;
    key?: U;
    value?: V;
    NX?: boolean;
    XX?: boolean;
    options?: {
        set?: SetOptions;
        expire?: { [K in RedisExpireCondition]?: boolean; };
        command?: CommandOptions;
    };
}

export interface RedisSetValue extends RedisCommand<"HASH", RedisArgument, RedisCommandValue | RedisHSETObject> {
    field?: RedisCommandValue | RedisHSETObject;
    EX?: number;
    PX?: number;
    EXAT?: number;
    PXAT?: number;
    KEEPTTL?: boolean;
}

export interface RedisJSONValue extends RedisCommand<"JSON", string, RedisJSON | RedisJSON[]> {
    command?: RedisCommandJSON;
    path?: string;
    start?: number | string;
    stop?: number | string;
    index?: number | string;
}

export interface RedisQuery {
    index?: string;
    schema?: RediSearchSchema | string;
    query?: string;
    options?: PlainObject;
}

export interface JsonMSetItem {
    key: RedisArgument;
    path: RedisArgument;
    value: RedisJSON;
}

export type RedisFormat = "HASH" | "JSON";
export type RedisCommandJSON = "ARRAPPEND" | "ARRINDEX" | "ARRINSERT" | "ARRPOP" | "ARRTRIM" | "DEL" | "FORGET" | "MERGE" | "MSET" | "NUMINCRBY" | "NUMMULTBY" | "SET" | "STRAPPEND";
export type RedisExpireCondition = "NX" | "XX" | "GT" | "LT";
export type RedisCommandValue = RedisArgument | number;
export type RedisClientPoolType<T extends RedisModules = RedisDefaultModules> = IRedisClientPoolType<T>;
export type RedisClientPoolInstance = IRedisClientPoolType<any, any, any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type RedisHSETObject = Record<number | string, RedisCommandValue>;
export type DbPoolCredential = RedisClientOptions & IdentifierAction;

export type { CommandOptions, RedisArgument, RedisJSON, ScanOptions };