import { Redis } from 'ioredis';
import { InMemorySessionStore } from './session/inMemorySessionStore';
import { RedisSessionStore } from './session/redisSessionStore';
import { RedisMessageStore } from './messages/redisMessageStore';
import type { SessionStore } from '../types';

export function createSessionStore(config: { 
  type: 'memory' | 'redis';
  redis?: Redis;
}): SessionStore {
  if (config.type === 'redis') {
    if (!config.redis) {
      throw new Error('Redis instance is required for Redis session store');
    }
    return new RedisSessionStore(config.redis);
  }
  
  return new InMemorySessionStore();
}

// Re-export the session store types for convenience
export { InMemorySessionStore } from './session/inMemorySessionStore';
export { RedisSessionStore } from './session/redisSessionStore';
export { RedisMessageStore} from './messages/redisMessageStore';