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
   * Get messages for a room with pagination support
   * @param apiKey The API key for namespacing
   * @param roomId The room ID
   * @param options Pagination options
   * @returns Array of messages
   */
  async getMessages(
    apiKey: string, 
    roomId: string, 
    options: { 
      limit?: number; 
      before?: string; // message ID to start before
      after?: string;  // message ID to start after
    } = {}
  ): Promise<ChatMessage[]> {
    const { limit = 50, before = null, after = null } = options;
    
    // Get the index of messages in this room
    const roomIndexKey = `${apiKey}:room:messages:index:${roomId}`;
    
    let messageIds: string[] = [];
    let startScore = '-inf';
    let endScore = '+inf';
    
    // If we're paginating before a message, get its timestamp
    if (before) {
      const beforeMsg = await this.getMessageById(apiKey, roomId, before);
      if (beforeMsg) {
        endScore = '(' + new Date(beforeMsg.timestamp).getTime().toString();
      }
    }
    
    // If we're paginating after a message, get its timestamp
    if (after) {
      const afterMsg = await this.getMessageById(apiKey, roomId, after);
      if (afterMsg) {
        startScore = '(' + new Date(afterMsg.timestamp).getTime().toString();
      }
    }
    
    // Get message IDs in the specified range
    if (after) {
      // When paginating forward, we want newer messages (higher scores)
      messageIds = await this.redis.zrangebyscore(
        roomIndexKey, 
        startScore, 
        endScore, 
        'LIMIT', 
        0, 
        limit
      );
    } else {
      // When paginating backward or initial load, we want older messages (lower scores)
      messageIds = await this.redis.zrevrangebyscore(
        roomIndexKey, 
        endScore, 
        startScore, 
        'LIMIT', 
        0, 
        limit
      );
    }
    
    if (!messageIds.length) {
      return [];
    }
    
    // Get all messages in a single operation
    const roomMessagesKey = `${apiKey}:room:messages:data:${roomId}`;
    const messageData = await this.redis.hmget(
      roomMessagesKey,
      ...messageIds
    );
    
    // Parse messages and filter out any null values
    const messages = messageData
      .map((data, index) => {
        if (!data) return null;
        try {
          return JSON.parse(data) as ChatMessage;
        } catch (e) {
          console.error(`Error parsing message ${messageIds[index]}:`, e);
          return null;
        }
      })
      .filter(msg => msg !== null) as ChatMessage[];
    
    // Sort by timestamp (oldest first by default)
    return messages.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  /**
   * Get a specific message by ID
   * @param apiKey The API key for namespacing
   * @param roomId The room ID
   * @param messageId The message ID
   * @returns The message or null if not found
   */
  async getMessageById(apiKey: string, roomId: string, messageId: string): Promise<ChatMessage | null> {
    const roomMessagesKey = `${apiKey}:room:messages:data:${roomId}`;
    const messageJson = await this.redis.hget(roomMessagesKey, messageId);
    
    if (!messageJson) {
      return null;
    }
    
    try {
      return JSON.parse(messageJson) as ChatMessage;
    } catch (e) {
      console.error(`Error parsing message ${messageId}:`, e);
      return null;
    }
  }

  /**
   * Get recent conversations for a user
   * @param apiKey The API key for namespacing
   * @param userId The user ID
   * @param limit Maximum number of conversations to return
   * @returns Array of conversation data with last message
   */
  async getRecentConversations(
    apiKey: string, 
    userId: string, 
    limit: number = 20
  ): Promise<Array<{
    roomId: string;
    lastMessage: ChatMessage;
    unreadCount: number;
    lastActivity: number;
    otherUserId: string;
  }>> {
    // Get room meta keys that contain this user's ID
    const roomMetaPattern = `${apiKey}:room:meta:*${userId}*`;
    const roomMetaKeys = await this.redis.keys(roomMetaPattern);
    
    if (!roomMetaKeys.length) {
      return [];
    }
    
    // Get activity timestamps for sorting
    const roomData = await Promise.all(roomMetaKeys.map(async (metaKey) => {
      const roomId = metaKey.replace(`${apiKey}:room:meta:`, '');
      const meta = await this.redis.hgetall(metaKey);
      return {
        roomId,
        lastActivity: parseInt(meta.lastActivity || '0')
      };
    }));
    
    // Sort by activity and limit
    const sortedRoomIds = roomData
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .slice(0, limit)
      .map(room => room.roomId);
    
    if (!sortedRoomIds.length) {
      return [];
    }
    
    // Get conversation data in parallel
    const conversations = await Promise.all(sortedRoomIds.map(async (roomId) => {
      // Extract other user ID from room ID
      const [user1, user2] = roomId.split('_');
      const otherUserId = user1 === userId ? user2 : user1;
      
      // Get room metadata
      const roomMetaKey = `${apiKey}:room:meta:${roomId}`;
      const meta = await this.redis.hgetall(roomMetaKey);
      
      // Get last message
      const lastMessage = await this.getMessages(apiKey, roomId, { limit: 1 });
      
      return {
        roomId,
        lastMessage: lastMessage[0] || null,
        unreadCount: parseInt(meta.unreadCount || '0'),
        lastActivity: parseInt(meta.lastActivity || '0'),
        otherUserId
      };
    }));
    
    // Filter out conversations with no messages
    return conversations
      .filter(conv => conv.lastMessage !== null)
      .map(conv => ({
        ...conv,
        otherUserId: conv.otherUserId as string
      }));
  }
}