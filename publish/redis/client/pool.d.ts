import type { DbPoolConstructor } from '@e-mc/types/lib/db';

import type { DbPoolCredential, RedisClientPoolInstance, RedisClientPoolType, RedisDataSource } from '../types';

declare const RedisPool: DbPoolConstructor<RedisDataSource, RedisClientPoolInstance, RedisClientPoolType, DbPoolCredential>;

export = RedisPool;