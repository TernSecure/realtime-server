import { Redis } from 'ioredis';
import { 
    ChatMessage,
    MESSAGE_ID_PREFIX,
    ROOM_MESSAGES_PREFIX,
 } from '../../types';

// Constants for Redis keys
const MESSAGE_TTL = 24 * 60 * 60;
const DELIVERY_STATUS_PREFIX = 'delivery:status:';

export class RedisMessageStore {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

/**
 * Save a message to Redis with optimizations for high message volume
 * @param apiKey The API key for namespacing
 * @param message The message to save
 * @param ttl Optional TTL in seconds (defaults to 24 hours)
 */
async saveMessage(apiKey: string, message: ChatMessage, ttl: number = MESSAGE_TTL): Promise<void> {
    // Use pipeline to reduce network round-trips
    const pipeline = this.redis.pipeline();
    
    // Store message in a hash by room with message ID as field
    // This reduces the number of Redis keys and improves memory efficiency
    const roomMessagesKey = `${apiKey}:room:messages:data:${message.roomId}`;
    pipeline.hset(
      roomMessagesKey,
      message.messageId,
      JSON.stringify(message)
    );
    pipeline.expire(roomMessagesKey, ttl);
    
    // Add message ID to the room's sorted set with timestamp as score
    // This maintains chronological ordering for efficient retrieval
    const roomIndexKey = `${apiKey}:room:messages:index:${message.roomId}`;
    const timestamp = new Date(message.timestamp).getTime();
    pipeline.zadd(roomIndexKey, timestamp, message.messageId);
    pipeline.expire(roomIndexKey, ttl);
    
    // Update room metadata (message count, last activity)
    const roomMetaKey = `${apiKey}:room:meta:${message.roomId}`;
    pipeline.hincrby(roomMetaKey, 'messageCount', 1);
    pipeline.hset(roomMetaKey, 'lastActivity', timestamp.toString());
    pipeline.expire(roomMetaKey, ttl);
    
    // Update user's active conversations list
    // This helps build the chat history UI efficiently
    if (message.fromId) {
      const senderConversationsKey = `${apiKey}:user:conversations:${message.fromId}`;
      pipeline.zadd(senderConversationsKey, timestamp, message.roomId);
      pipeline.expire(senderConversationsKey, ttl);
    }
    
    if (message.toId) {
      const recipientConversationsKey = `${apiKey}:user:conversations:${message.toId}`;
      pipeline.zadd(recipientConversationsKey, timestamp, message.roomId);
      pipeline.expire(recipientConversationsKey, ttl);
    }
    
    // Execute all commands in a single round-trip
    await pipeline.exec();
  }

  /**
   * Get a message by ID
   * @param apiKey The API key for namespacing
   * @param messageId The message ID
   * @returns The message or null if not found
   */
  async getMessageById(apiKey: string, messageId: string): Promise<ChatMessage | null> {
    const messageKey = `${apiKey}:${MESSAGE_ID_PREFIX}${messageId}`;
    const messageJson = await this.redis.get(messageKey);
    
    if (!messageJson) {
      return null;
    }
    
    return JSON.parse(messageJson) as ChatMessage;
  }

  /**
   * Get recent messages for a room
   * @param apiKey The API key for namespacing
   * @param roomId The room ID
   * @param limit Maximum number of messages to return (default 100)
   * @returns Array of messages
   */
  async getRecentRoomMessages(apiKey: string, roomId: string, limit: number = 100): Promise<ChatMessage[]> {
    const roomKey = `${apiKey}:${ROOM_MESSAGES_PREFIX}${roomId}`;
    
    // Get the most recent message IDs (highest scores first)
    const messageIds = await this.redis.zrevrange(roomKey, 0, limit - 1);
    
    if (!messageIds.length) {
      return [];
    }
    
    // Get all messages in parallel
    const messagePromises = messageIds.map(id => 
      this.getMessageById(apiKey, id)
    );
    
    const messages = await Promise.all(messagePromises);
    
    // Filter out any null messages (in case they expired)
    return messages.filter(msg => msg !== null) as ChatMessage[];
  }

  /**
   * Delete a message
   * @param apiKey The API key for namespacing
   * @param messageId The message ID
   * @param roomId The room ID
   */
  async deleteMessage(apiKey: string, messageId: string, roomId: string): Promise<void> {
    const messageKey = `${apiKey}:${MESSAGE_ID_PREFIX}${messageId}`;
    const roomKey = `${apiKey}:${ROOM_MESSAGES_PREFIX}${roomId}`;
    const deliveryKey = `${apiKey}:${DELIVERY_STATUS_PREFIX}${messageId}`;
    
    // Remove message from storage
    await this.redis.del(messageKey);
    
    // Remove message ID from room
    await this.redis.zrem(roomKey, messageId);
    
    // Remove delivery status
    await this.redis.del(deliveryKey);
  }

  /**
   * Mark a message as delivered
   * @param apiKey The API key for namespacing
   * @param messageId The message ID
   */
  async markMessageAsDelivered(apiKey: string, messageId: string): Promise<void> {
    const deliveryKey = `${apiKey}:${DELIVERY_STATUS_PREFIX}${messageId}`;
    
    // Store delivery status with timestamp
    await this.redis.hmset(deliveryKey, {
      delivered: 'true',
      deliveredAt: new Date().toISOString()
    });
    
    // Set expiration on delivery status (same as message TTL)
    await this.redis.expire(deliveryKey, MESSAGE_TTL);
  }

  /**
   * Check if a message has been delivered
   * @param apiKey The API key for namespacing
   * @param messageId The message ID
   * @returns Whether the message has been delivered
   */
  async isMessageDelivered(apiKey: string, messageId: string): Promise<boolean> {
    const deliveryKey = `${apiKey}:${DELIVERY_STATUS_PREFIX}${messageId}`;
    const delivered = await this.redis.hget(deliveryKey, 'delivered');
    return delivered === 'true';
  }

  /**
   * Get all undelivered messages for a user
   * @param apiKey The API key for namespacing
   * @param userId The user ID
   * @returns Array of undelivered messages
   */
  async getUndeliveredMessages(apiKey: string, userId: string): Promise<ChatMessage[]> {
    // We'll need to scan through rooms where this user is a participant
    const userRoomPattern = `${apiKey}:${ROOM_MESSAGES_PREFIX}*${userId}*`;
    
    // Get all matching room keys
    const roomKeys = await this.scanKeys(userRoomPattern);
    
    const allMessages: ChatMessage[] = [];
    
    // For each room, get messages and check delivery status
    for (const roomKey of roomKeys) {
      // Extract roomId from the key
      const roomId = roomKey.split(`${apiKey}:${ROOM_MESSAGES_PREFIX}`)[1];
      
      // Get recent messages for this room
      const roomMessages = await this.getRecentRoomMessages(apiKey, roomId);
      
      // Check each message for delivery status
      for (const message of roomMessages) {
        if (message.toId === userId) {
          const isDelivered = await this.isMessageDelivered(apiKey, message.messageId);
          if (!isDelivered) {
            allMessages.push(message);
          }
        }
      }
    }
    
    return allMessages;
  }

  /**
   * Helper method to scan Redis for keys matching a pattern
   * @param pattern The key pattern to match
   * @returns Array of matching keys
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    let cursor = '0';
    const keys: string[] = [];
    
    do {
      // Scan for keys matching the pattern
      const [nextCursor, matchedKeys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );
      
      cursor = nextCursor;
      keys.push(...matchedKeys);
      
    } while (cursor !== '0');
    
    return keys;
  }
}