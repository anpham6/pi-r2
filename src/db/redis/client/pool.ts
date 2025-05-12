import type { DbPoolConstructor } from '@e-mc/types/lib/db';

import type { DbPoolCredential, RedisClientPoolInstance, RedisClientPoolType, RedisDataSource } from '../types';

import type { RedisClientOptions } from 'redis';

const DbPool = require('@e-mc/db/pool') as DbPoolConstructor<RedisDataSource, RedisClientPoolInstance, RedisClientPoolType, DbPoolCredential>;

const POOL_ACTIVE = new WeakSet<DbPoolCredential>();

class RedisPool extends DbPool {
    static override CACHE_IGNORE = ['modules', 'functions', 'scripts', 'credentialsProvider'] satisfies Array<keyof RedisClientOptions>;

    static override asString(credential: DbPoolCredential) {
        if (credential.url) {
            return JSON.stringify(credential);
        }
        return super.asString(credential);
    }

    static override sanitize<T extends DbPoolCredential>(credential: T) {
        if (!this.canCache(credential)) {
            return;
        }
        if (!POOL_ACTIVE.has(credential) || credential.uuidKey) {
            return credential;
        }
        if ('socket' in credential) {
            return { ...credential, socket: credential.socket?.tls ? { tls: true } : undefined };
        }
        return credential;
    }

    async getConnection(credential?: DbPoolCredential) {
        if (credential) {
            POOL_ACTIVE.add(credential);
        }
        return this.client.connect() as Promise<RedisClientPoolType>;
    }
    async close() {
        return this.client.close();
    }
    isEmpty() {
        return this.closed || this.closeable;
    }
    get closed() {
        return !this.client.isOpen;
    }
    get closeable() {
        return this.client.totalClients === 0;
    }
}

export = RedisPool;