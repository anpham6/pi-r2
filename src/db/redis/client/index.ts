import type { IDb } from '@e-mc/types/lib';
import type { CacheOptions } from '@e-mc/types/lib/core';
import type { BatchQueryResult, CheckObjectCallback, ErrorQueryCallback, ExecuteBatchQueryOptions, QueryResult } from '@e-mc/types/lib/db';

import type { CommandOptions, DbPoolCredential, JsonMSetItem, RedisArgument, RedisClientPoolType, RedisCommand, RedisCommandJSON, RedisCommandValue, RedisCredential, RedisDataSource, RedisExpireCondition, RedisFormat, RedisHSETObject, RedisJSON, RedisJSONValue, RedisSetValue, ScanOptions } from '../types';

import type { RediSearchSchema, RedisClientOptions, RedisClientType, RedisPoolOptions } from 'redis';

import { DB_TRANSACTION, ERR_DB, ERR_MESSAGE, LOG_TYPE } from '@e-mc/types/constant';

import redis = require('redis');

import { randomUUID } from 'node:crypto';

import Db = require('@e-mc/db');

import { DB_TYPE, asFunction, coerceObject, errorMessage, isArray, isObject, isPlainObject, isString } from '@e-mc/types';
import { parseConnectionString, parseServerAuth } from '@e-mc/db/util';

import DbPool = require('./pool');

const enum STRINGS {
    MODULE_NAME = 'redis',
    ERR_CLIENT_CLOSE = 'The client is closed',
    ERR_CLIENT_DISCONNECT = 'Disconnects client'
}

const enum VALUES {
    PORT = 6379
}

const POOL_STATE: ObjectMap<DbPool> = {};

async function doScan(client: RedisClientType | RedisClientPoolType, key: RedisArgument, index: number, cursor: RedisDataSource["cursor"] = [], iterations: number | number[] = [], options?: ScanOptions) {
    const target = (Array.isArray(cursor) ? cursor : [cursor]).map(item => Buffer.isBuffer(item) ? item : item.toString());
    if (!Array.isArray(iterations)) {
        iterations = [iterations];
    }
    let result: unknown[] = [],
        current = target[index] ?? '0',
        length = iterations[index] ?? Infinity;
    do {
        const item = await client.hScan(key, current, options);
        result = result.concat(item.entries);
        current = item.cursor;
    }
    while (+current > 0 && --length > 0);
    return result;
}

const convertFloat = (value: unknown) => typeof value === 'number' || isString(value) && !isNaN(value = +value) ? value as number : undefined;

export async function setCredential(this: IDb, item: RedisDataSource) {
    const credential = this.getCredential<RedisCredential>(item);
    const options = item.options ||= {};
    const client = isPlainObject<RedisClientOptions>(options.client) ? options.client : options.client = {};
    let { uri, username, password, database = 0 } = item;
    if (database > 0) {
        client.database = database;
    }
    if (credential) {
        const auth = parseServerAuth(credential, VALUES.PORT);
        if (auth.database && (database = +auth.database) > 0) {
            client.database ||= database;
        }
        uri ||= (auth.protocol || 'redis:') + '//' + (auth.server || 'localhost:' + (auth.port ? auth.port : VALUES.PORT));
        username ||= auth.username;
        password ||= auth.password;
    }
    else {
        delete item.credential;
    }
    if (!uri) {
        throw errorMessage(STRINGS.MODULE_NAME, ERR_DB.CREDENTIALS, 'url');
    }
    if (client.socket?.tls) {
        this.readTLSConfig(client.socket);
    }
    client.url = uri;
    if (username) {
        client.username = username;
    }
    if (password) {
        client.password = password;
    }
    const usePool = item.usePool;
    if (!usePool) {
        return;
    }
    let pool: Optional<DbPool>;
    username = undefined;
    password = undefined;
    if (isString(usePool)) {
        username = client.username || parseConnectionString(uri)?.username;
        if (username) {
            [password, pool] = DbPool.validateKey(POOL_STATE, username, usePool);
            if (pool) {
                pool.add(item, password);
                return;
            }
        }
        if (!password) {
            item.usePool = '';
            return;
        }
    }
    const config = this.getPoolConfig(STRINGS.MODULE_NAME, password);
    const poolOptions: Partial<RedisPoolOptions> = {};
    if (config) {
        const { min, max, timeout } = config;
        if (min >= 0) {
            poolOptions.minimum ??= min;
        }
        if (max > 0) {
            poolOptions.maximum ??= max;
        }
        if (timeout > 0) {
            poolOptions.acquireTimeout ??= timeout;
        }
    }
    const poolKey = DbPool.asString(client);
    if ((pool = POOL_STATE[poolKey]) && !pool.closed) {
        pool.add(item);
        return;
    }
    try {
        const clientPool = redis.createClientPool(client, poolOptions);
        clientPool.on('end', () => {
            delete POOL_STATE[poolKey];
        });
        const instance = new DbPool(clientPool, poolKey, username && password ? { username, password } : undefined).add(item);
        instance.parent = POOL_STATE;
        instance.success = 1;
    }
    catch {
        item.usePool = false;
    }
}

export async function executeQuery(this: IDb, item: RedisDataSource, options?: ExecuteBatchQueryOptions | string) {
    return (await executeBatchQuery.call(this, [item], options))[0] || [];
}

export async function executeBatchQuery(this: IDb, batch: RedisDataSource[], options: ExecuteBatchQueryOptions | string | undefined = '', outResult?: BatchQueryResult) {
    const length = batch.length;
    if (length === 0) {
        return [];
    }
    let parallel: boolean | undefined,
        checkObject: CheckObjectCallback | string | undefined,
        connectOnce: boolean | undefined,
        errorQuery: ErrorQueryCallback | undefined,
        sessionKey: string | undefined,
        outCacheMiss: string[] | undefined;
    if (isPlainObject<ExecuteBatchQueryOptions>(options)) {
        ({ parallel, checkObject, connectOnce, errorQuery, sessionKey, outCacheMiss } = options);
    }
    else {
        if (typeof options === 'string') {
            sessionKey = options;
        }
        options = undefined;
    }
    if (length === 1) {
        connectOnce = false;
        parallel = false;
    }
    else if (parallel === undefined) {
        parallel = !batch.some(item => item.parallel === false);
    }
    if (!parallel) {
        outResult ||= new Array(length);
    }
    const caching = this.hasCache(STRINGS.MODULE_NAME, sessionKey);
    const tasks: Promise<QueryResult>[] = new Array(length);
    const clients: RedisClientType[] = [];
    const pools: RedisClientPoolType[] = [];
    let redisClient: RedisClientType | RedisClientPoolType | undefined,
        redisPool: RedisClientPoolType | undefined,
        redisCredential: RedisClientOptions | undefined,
        onceCredential = connectOnce ? batch[0].options?.client : undefined;
    const getConnection = async (item: RedisDataSource, credential: RedisClientOptions) => {
        if (redisPool) {
            return redisPool;
        }
        item.transactionState = DB_TRANSACTION.AUTH;
        let client: RedisClientType | RedisClientPoolType | undefined;
        if (item.usePool) {
            const pool = DbPool.findKey(POOL_STATE, item.usePool, DbPool.asString(credential), ...connectOnce ? [item, batch[0]] : [item]);
            if (pool) {
                pools.push(client = await pool.getConnection(credential));
                if (connectOnce) {
                    redisPool = client;
                }
                pool.connected = true;
            }
        }
        if (!client) {
            client = redis.createClient(credential) as RedisClientType;
            await client.connect();
            clients.push(client);
        }
        if (connectOnce) {
            redisClient = client;
            redisCredential = credential;
        }
        item.transactionState &= ~DB_TRANSACTION.AUTH;
        return client;
    };
    if (this.host?.username) {
        this.applyCommand(...batch);
    }
    for (let i = 0; i < length; ++i) {
        const item = batch[i];
        const { source, key, format = 'HASH', search, aggregate, streams, options: clientOptions = {}, ignoreCache } = item;
        let credential = (redisCredential || onceCredential) as DbPoolCredential | undefined,
            error: unknown;
        if (!credential && !isPlainObject<DbPoolCredential>(credential = clientOptions.client!) && (error = errorMessage(source, ERR_DB.CREDENTIALS)) || !(isString(key) || isArray(key) || isPlainObject(search) && (isPlainObject(search.schema) || isString(search.query)) || isPlainObject(aggregate) && (isPlainObject(aggregate.schema) || isString(aggregate.query))) && (error = errorMessage(source, ERR_DB.QUERY, item.uri))) {
            if (this.handleFail(error, item, { errorQuery })) {
                if (!parallel) {
                    tasks.length = 0;
                    break;
                }
                tasks[i] = Promise.reject(error);
            }
            else if (parallel) {
                tasks[i] = Promise.resolve([]);
            }
            else {
                outResult![i] = [];
            }
            continue;
        }
        item.transactionState = DB_TRANSACTION.ACTIVE;
        const uuidKey = credential.uuidKey ||= ((onceCredential ? batch[0] : item).credential as RedisCredential | undefined)?.uuidKey;
        const targetObject = typeof checkObject === 'string' ? this.hasCoerce(STRINGS.MODULE_NAME, 'options', uuidKey) && asFunction(checkObject) : checkObject;
        const cacheValue = ignoreCache === undefined ? sessionKey : Array.isArray(ignoreCache) ? { sessionKey, exclusiveOf: ignoreCache } as CacheOptions : { sessionKey, renewCache: ignoreCache === 0 } as CacheOptions;
        let queryString = '',
            rows: QueryResult | undefined;
        if (caching && ignoreCache !== true) {
            if (isObject(search)) {
                queryString = Db.asString(search, true);
            }
            else if (isObject(aggregate)) {
                queryString = Db.asString(aggregate, true);
            }
            else if (streams) {
                queryString = Db.asString(streams, true);
            }
            else if (!targetObject) {
                queryString = Db.asString(key, true);
            }
            else if (item.cacheObjectKey) {
                queryString = Db.asString(key, true) + '_' + targetObject.toString() + item.cacheObjectKey;
            }
            if (queryString) {
                queryString += '_' + format;
            }
            if (ignoreCache !== 1) {
                rows = this.getQueryResult(source, DbPool.sanitize(credential), queryString, cacheValue);
                if (rows) {
                    if (parallel) {
                        tasks[i] = Promise.resolve(rows);
                    }
                    else {
                        outResult![i] = rows;
                    }
                    this.add(item, DB_TRANSACTION.COMMIT | DB_TRANSACTION.CACHE);
                    continue;
                }
                if (!ignoreCache && outCacheMiss) {
                    outCacheMiss.push(source);
                }
            }
        }
        if (onceCredential && parallel) {
            try {
                redisClient = await getConnection(item, onceCredential);
            }
            catch {
                connectOnce = false;
                parallel = false;
            }
            onceCredential = undefined;
        }
        tasks[i] = new Promise<QueryResult>(async (resolve, reject) => {
            let commandType: number | undefined;
            try {
                let client = redisClient || await getConnection(item, credential);
                const a = (arg: unknown): arg is RedisCommandValue => typeof arg === 'string' || Buffer.isBuffer(arg) || typeof arg === 'number';
                const b = (arg: unknown): string => typeof arg === 'number' || Buffer.isBuffer(arg) ? arg.toString() : arg as string;
                if (item.update) {
                    commandType = this.commandType.UPDATE;
                    const values = (!Array.isArray(item.update) ? [item.update] : item.update).map(async target => {
                        return new Promise<RedisSetValue | RedisJSONValue>(async (success, failed) => {
                            let { key: k, value: v, format: f, NX, XX, options: setOptions = {} } = target as RedisCommand;
                            f = (isString(f) ? f.toUpperCase() : 'HASH') as RedisFormat;
                            if (v === undefined && f !== 'JSON') {
                                success(target);
                                return;
                            }
                            const has = (n: unknown): n is number => typeof n === 'number' && n > 0;
                            const failKey = () => {
                                failed(errorMessage(f, ERR_DB.KEY, Db.asString(k) || ERR_MESSAGE.UNKNOWN));
                            };
                            const failValue = () => {
                                failed(errorMessage(f, ERR_DB.VALUE, Db.asString(v) || ERR_MESSAGE.UNKNOWN));
                            };
                            if (isPlainObject<CommandOptions>(setOptions.command)) {
                                client = client.withCommandOptions(setOptions.command);
                            }
                            let pending: Promise<unknown> | undefined,
                                codeMin = 0,
                                EX: number | undefined,
                                PX: number | undefined,
                                EXAT: number | undefined,
                                PXAT: number | undefined,
                                KEEPTTL: boolean | undefined;
                            if (f === 'JSON') {
                                if (typeof k !== 'string') {
                                    failKey();
                                    return;
                                }
                                if (this.hasCoerce(STRINGS.MODULE_NAME, 'options', uuidKey) && isString(v) && v.startsWith('new')) {
                                    ({ outV: v } = coerceObject({ outV: v }));
                                }
                                const { path = '$', command: cmd, start, stop, index } = target as RedisJSONValue;
                                const name = (isString(cmd) ? cmd.toUpperCase() : 'SET') as RedisCommandJSON;
                                switch (name) {
                                    case 'ARRAPPEND':
                                    case 'ARRINSERT': {
                                        let v1: RedisJSON,
                                            v2: RedisJSON[];
                                        if (isArray<RedisJSON>(v)) {
                                            v1 = v[0];
                                            v2 = v.slice(1);
                                        }
                                        else {
                                            v1 = v as RedisJSON;
                                            v2 = [];
                                        }
                                        if (name === 'ARRAPPEND') {
                                            pending = client.json.arrAppend(k, path, v1, ...v2);
                                        }
                                        else if (typeof index === 'number') {
                                            pending = client.json.arrInsert(k, path, index, v1, ...v2);
                                        }
                                        break;
                                    }
                                    case 'ARRINDEX': {
                                        const s1 = convertFloat(start);
                                        codeMin = -1;
                                        pending = client.json.arrIndex(k, path, v as RedisJSON, s1 !== undefined ? { range: { start: s1, stop: convertFloat(stop) } } : undefined);
                                        break;
                                    }
                                    case 'ARRPOP':
                                        codeMin = -Infinity;
                                        pending = client.json.arrPop(k, { path, index: convertFloat(index) });
                                        break;
                                    case 'ARRTRIM': {
                                        const s1 = convertFloat(start);
                                        const s2 = convertFloat(stop);
                                        if (s1 !== undefined && s2 !== undefined) {
                                            pending = client.json.arrTrim(k, path, s1, s2);
                                        }
                                        break;
                                    }
                                    case 'DEL':
                                    case 'FORGET':
                                        pending = client.json[name === 'DEL' ? 'del' : 'forget'](k, { path });
                                        break;
                                    case 'MERGE':
                                        pending = client.json.merge(k, path, v as RedisJSON);
                                        break;
                                    case 'MSET': {
                                        const data = (Array.isArray(v) ? v : [v])
                                            .filter((m: Partial<JsonMSetItem>) => m.value !== undefined)
                                            .map((m: Partial<JsonMSetItem>) => {
                                                m.key ||= k;
                                                m.path ||= path;
                                                return m;
                                            }) as JsonMSetItem[];
                                        if (data.length > 0) {
                                            pending = client.json.mSet(data);
                                        }
                                        break;
                                    }
                                    case 'NUMINCRBY':
                                    case 'NUMMULTBY': {
                                        const n = convertFloat(v);
                                        if (n !== undefined) {
                                            pending = client.json[name === 'NUMINCRBY' ? 'numIncrBy' : 'numMultBy'](k, path, n);
                                        }
                                        break;
                                    }
                                    case 'STRAPPEND':
                                        if (isString(v)) {
                                            pending = client.json.strAppend(k, v, { path });
                                        }
                                        break;
                                    default: {
                                        const flags = NX ? { NX } : XX ? { XX } : undefined;
                                        pending = client.json.set(k, path, v as RedisJSON, flags);
                                        break;
                                    }
                                }
                            }
                            else if (typeof k === 'string' || Buffer.isBuffer(k)) {
                                ({ EX, PX, EXAT, PXAT, KEEPTTL } = target as RedisSetValue);
                                const field = (target as RedisSetValue).field;
                                if (field === undefined && field === null) {
                                    if (a(v)) {
                                        const flags = setOptions.set || {};
                                        if (NX) {
                                            flags.condition = 'NX';
                                        }
                                        if (XX) {
                                            flags.condition = 'XX';
                                        }
                                        if (has(EX)) {
                                            flags.expiration = { type: 'EX', value: EX };
                                            EX = 0;
                                        }
                                        if (has(PX)) {
                                            flags.expiration = { type: 'PX', value: PX };
                                            PX = 0;
                                        }
                                        if (has(EXAT)) {
                                            flags.expiration = { type: 'EXAT', value: EXAT };
                                            EXAT = 0;
                                        }
                                        if (has(PXAT)) {
                                            flags.expiration = { type: 'PXAT', value: PXAT };
                                            PXAT = 0;
                                        }
                                        if (KEEPTTL) {
                                            flags.expiration = { type: 'KEEPTTL' };
                                            KEEPTTL = false;
                                        }
                                        codeMin = NaN;
                                        pending = client.set(k, v, flags);
                                    }
                                    else if (isObject<RedisHSETObject>(v)) {
                                        let valid = true;
                                        if (NX || XX) {
                                            valid = await client.exists(k) === 1;
                                            if (NX) {
                                                valid = !valid;
                                            }
                                        }
                                        if (!valid) {
                                            success(target);
                                            return;
                                        }
                                        pending = client.hSet(k, v);
                                    }
                                }
                                else if (NX) {
                                    if (a(field) && a(v)) {
                                        codeMin = -1;
                                        pending = client.hSetNX(k, b(field), b(v));
                                    }
                                }
                                else {
                                    let valid = 1;
                                    if (XX && a(k) && a(field)) {
                                        valid = await client.hExists(b(k), b(field));
                                    }
                                    if (a(field) && a(v)) {
                                        if (valid === 0) {
                                            success(target);
                                            return;
                                        }
                                        pending = client.hSet(k, field, v);
                                    }
                                }
                            }
                            else {
                                failKey();
                                return;
                            }
                            if (pending) {
                                pending.then(async code => {
                                    if (code === undefined || code === null || code !== -Infinity && isString(code) && code !== 'OK' || typeof code === 'number' && code <= codeMin || Array.isArray(code) && code.every(resp => resp === null || typeof resp === 'number' && resp <= codeMin)) {
                                        failValue();
                                        return;
                                    }
                                    let ttl = false;
                                    if (!isNaN(codeMin) && (has(EX) || has(PX) || has(EXAT) || has(PXAT) || (ttl = !!KEEPTTL))) {
                                        const expire = setOptions.expire;
                                        let mode: RedisExpireCondition | undefined;
                                        if (expire) {
                                            if (expire.NX) {
                                                mode = 'NX';
                                            }
                                            else if (expire.XX) {
                                                mode = 'XX';
                                            }
                                            else if (expire.GT) {
                                                mode = 'GT';
                                            }
                                            else if (expire.LT) {
                                                mode = 'LT';
                                            }
                                        }
                                        if (ttl) {
                                            PX = await client.pTTL(k as string).catch((err: unknown) => {
                                                failed(err);
                                                return 0;
                                            });
                                            if (PX <= 0) {
                                                success(target);
                                                return;
                                            }
                                        }
                                        (has(EX) ? client.expire(k as string, EX, mode) : has(PX) ? client.pExpire(k as string, PX, mode) : has(EXAT) ? client.expireAt(k as string, EXAT, mode) : client.pExpireAt(k as string, PXAT!, mode))
                                            .then(valid => {
                                                if (valid) {
                                                    success(target);
                                                }
                                                else {
                                                    failed(errorMessage(f, ERR_DB.VALUE, has(EX) ? 'EX: ' + EX : has(PX) ? 'PX: ' + PX : has(EXAT) ? 'EXAT: ' + EX : 'PXAT: ' + PXAT));
                                                }
                                            })
                                            .catch(failed);
                                    }
                                    else {
                                        success(target);
                                    }
                                })
                                .catch(failed);
                            }
                            else {
                                failValue();
                            }
                        });
                    });
                    await Promise.allSettled(values)
                        .then(result => {
                            for (const cmd of result) {
                                if (cmd.status === 'rejected' && this.handleFail(cmd.reason, item, { errorQuery, commandType })) {
                                    reject(cmd.reason);
                                    break;
                                }
                            }
                        })
                        .catch((err: unknown) => {
                            if (this.handleFail(err, item, { errorQuery, commandType })) {
                                reject(err);
                            }
                        });
                }
                const commandOptions = credential.commandOptions || clientOptions.command;
                if (isPlainObject<CommandOptions>(commandOptions)) {
                    commandOptions.abortSignal ||= this.signal;
                    client = client.withCommandOptions(commandOptions);
                }
                commandType = this.commandType.SELECT;
                const target = isObject(search) ? search : isObject(aggregate) ? aggregate : null;
                if (target) {
                    const { query = '', schema, index } = target;
                    let idx = '';
                    if (isObject<RediSearchSchema>(schema)) {
                        idx = index || randomUUID();
                        await client.ft.create(idx, schema, target.options);
                    }
                    try {
                        if (target === search) {
                            const reply = await client.ft.search(index || idx, query, clientOptions.search);
                            rows = reply.documents.map(doc => (doc.value.__id__ = doc.id) && doc.value);
                        }
                        else {
                            ({ results: rows } = await client.ft.aggregate(index || idx, query, clientOptions.aggregate));
                        }
                    }
                    catch (err) {
                        this.addLog(this.statusType.WARN, err, { source: target === search ? 'FT.SEARCH' : 'FT.AGGREGATE' });
                        if (err instanceof Error) {
                            throw err;
                        }
                    }
                    finally {
                        if (idx && idx !== index) {
                            client.ft.dropIndex(idx).catch((err: unknown) => {
                                this.writeFail([`Unable to drop ${target === search ? 'search' : 'aggregate'} index`, idx], err, { type: LOG_TYPE.DB, fatal: false });
                            });
                        }
                    }
                }
                else if (streams) {
                    const data = await client.xRead(streams, clientOptions.xread);
                    if (data) {
                        rows = data;
                    }
                }
                else if (key) {
                    let data: unknown;
                    if (Array.isArray(key)) {
                        switch (format.toUpperCase()) {
                            case 'HKEYS':
                                data = await Promise.all(key.map(async k => client.hKeys(k)));
                                break;
                            case 'HVALS':
                                data = await Promise.all(key.map(async k => client.hVals(k)));
                                break;
                            case 'HSCAN':
                                data = await Promise.all(key.map(async (k, index) => doScan(client, k, index, item.cursor, item.iterations, clientOptions.scan)));
                                break;
                            case 'SMEMBERS':
                                data = await Promise.all(key.map(async k => client.sMembers(k)));
                                break;
                            case 'JSON':
                                data = (await client.json.mGet(key.map(c => b(c)), item.path || '$')).flat();
                                break;
                            default:
                                data = await client.mGet(key);
                                break;
                        }
                    }
                    else {
                        switch (format.toUpperCase()) {
                            case 'HKEYS':
                                data = await client.hKeys(key);
                                break;
                            case 'HVALS':
                                data = await client.hVals(key);
                                break;
                            case 'HSCAN':
                                data = await doScan(client, key, 0, item.cursor, item.iterations, clientOptions.scan);
                                break;
                            case 'SMEMBERS':
                                data = await client.sMembers(key);
                                break;
                            case 'JSON':
                                data = await client.json.get(b(key), clientOptions.get);
                                break;
                            default:
                                if (Array.isArray(item.field)) {
                                    data = await client.hmGet(key, item.field);
                                }
                                else if (item.field) {
                                    data = await client.hGet(key, item.field);
                                }
                                else {
                                    data = await client.hGetAll(key);
                                }
                                break;
                        }
                    }
                    rows = (targetObject ? targetObject(item, data) : data) as QueryResult;
                }
                if (rows === undefined) {
                    throw errorMessage(source, ERR_DB.QUERY);
                }
                this.add(item, DB_TRANSACTION.COMMIT);
                resolve(this.setQueryResult(source, DbPool.sanitize(redisCredential || credential), queryString, rows, cacheValue));
            }
            catch (err) {
                if (err instanceof Error) {
                    switch (err.message) {
                        case STRINGS.ERR_CLIENT_CLOSE:
                        case STRINGS.ERR_CLIENT_DISCONNECT: {
                            const pool = item.usePool && DbPool.findKey(POOL_STATE, item.usePool, DbPool.asString(credential));
                            if (pool) {
                                await pool.detach(true);
                            }
                            break;
                        }
                    }
                }
                if (this.handleFail(err, item, { errorQuery, commandType })) {
                    reject(err);
                }
                else {
                    resolve([]);
                }
            }
        });
        if (!parallel) {
            try {
                outResult![i] = await tasks[i];
            }
            catch {
                tasks.length = 0;
                break;
            }
        }
    }
    return this.processRows(
        batch,
        tasks,
        {
            parallel,
            disconnect() {
                for (const item of clients) {
                    item.destroy();
                }
                for (const item of pools) {
                    void item.close();
                }
            }
        },
        outResult
    );
}

export async function checkTimeout(value: number, limit = 0) {
    return DbPool.checkTimeout(POOL_STATE, value, limit);
}

export const DB_SOURCE_CLIENT = true;
export const DB_SOURCE_TYPE = DB_TYPE.NOSQL | DB_TYPE.KEYVALUE;