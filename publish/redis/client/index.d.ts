import type { IDbSourceClient } from '@e-mc/db/types';

import type { RedisDataSource } from '../types';

declare const Redis: IDbSourceClient<RedisDataSource>;

export = Redis;