import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import type { SocketData } from '../../types';
import {
  CLIENT_SOCKETS_PREFIX,
  SOCKET_MAP_PREFIX,
  API_KEY_CLIENTS_PREFIX,
  SessionStore
} from '../../types'
import { 
  getServerPublicKey, encryptForClient, decryptFromClient, hasClientPublicKey, 
  encryptAndPackMessage,
  decryptAndUnpackMessage
  } from '../../middleware';
import { response } from 'express';

//const SOCKET_MAP_TTL = 24 * 60 * 60;
const SOCKET_MAP_TTL = 3431


//const UNENCRYPTED_EVENTS = ['session', 'client:publicKey', 'encryption:ready'];
//const UNENCRYPTED_EVENTS: string[] = [];


{/*function setupBinaryTransmission(socket: Socket) {
  const clientId = socket.data?.clientId;
  const sessionId = socket.data?.sessionId;
  if (!clientId || !sessionId) return;
  
  // Store the original emit method
  const originalEmit = socket.emit;
  
  // Override emit to encrypt data and send as binary
  socket.emit = function(event: string, ...args: any[]): boolean {
    const payload = args[0];
    const sessionId = socket.data.sessionId; 
    const encryptionReady = socket.data.encryptionReady;


    if (socket.data.encryptionReady) {
      // Use Promise for encryption but maintain sync emit
      encryptAndPackMessage(clientId, sessionId, event, payload)
        .then(encryptedBuffer => {
          if (encryptedBuffer) {
            console.log(`Sending encrypted binary message for event: ${event}`);
            // Use call consistently
            originalEmit.call(socket, 'binary', encryptedBuffer, true);
          } else {
            console.warn(`Encryption failed for ${event}, falling back to unencrypted`);
            const binaryBuffer = Buffer.from(JSON.stringify({ event, data: payload }));
            originalEmit.call(socket, 'binary', binaryBuffer, false);
          }
        })
        .catch(error => {
          console.error(`Encryption error for ${event}:`, error);
          // Fallback on error
          const binaryBuffer = Buffer.from(JSON.stringify({ event, data: payload }));
          originalEmit.call(socket, 'binary', binaryBuffer, false);
        });
    } else {
      // Unencrypted path
      console.log(`Sending unencrypted binary message for event: ${event}`);
      const binaryBuffer = Buffer.from(JSON.stringify({ event, data: payload }));
      originalEmit.call(socket, 'binary', binaryBuffer, false);
    }

    return true; // Socket.IO expects synchronous return
  };

  socket.on('binary', async (data: Buffer | ArrayBuffer, isEncrypted: boolean, ack?: Function) => {
    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  
      if (isEncrypted && socket.data.encryptionReady) {
        // Handle encrypted binary data
        const message = await decryptAndUnpackMessage(clientId, sessionId, buffer);
        if (message) {
          const { event, data: messageData } = message;
          console.log(`Received encrypted binary message for event: ${event}`);
          
          // Check if there's an acknowledgment function
          if (typeof ack === 'function') {
            console.log(`Event ${event} has an acknowledgment function`);
            
            // Create a wrapper callback that will be passed to the event handler
            const wrappedCallback = (response: any) => {
              console.log(`Sending acknowledgment for ${event}:`, response);
              ack(response);
            };
            
            // Emit the event with the wrapped callback
            socket.listeners(event).forEach(handler => {
              try {
                handler(messageData, wrappedCallback);
              } catch (handlerError) {
                console.error(`Error in handler for ${event}:`, handlerError);
                wrappedCallback({ error: 'Internal server error' });
              }
            });
          } else {
            console.log(`Event ${event} has no acknowledgment function`);
            // No acknowledgment, just emit the event
            socket.listeners(event).forEach(handler => {
              try {
                handler(messageData);
              } catch (handlerError) {
                console.error(`Error in handler for ${event}:`, handlerError);
              }
            });
          }
        }
      } else {
        // Handle unencrypted binary data
        const { event, data: messageData } = JSON.parse(buffer.toString());
        console.log(`Received unencrypted binary message for event: ${event}`);
        
        // Check if there's an acknowledgment function
        if (typeof ack === 'function') {
          console.log(`Event ${event} has an acknowledgment function`);
          
          // Create a wrapper callback that will be passed to the event handler
          const wrappedCallback = (response: any) => {
            console.log(`Sending acknowledgment for ${event}:`, response);
            ack(response);
          };
          
          // Emit the event with the wrapped callback
          socket.listeners(event).forEach(handler => {
            try {
              handler(messageData, wrappedCallback);
            } catch (handlerError) {
              console.error(`Error in handler for ${event}:`, handlerError);
              wrappedCallback({ error: 'Internal server error' });
            }
          });
        } else {
          console.log(`Event ${event} has no acknowledgment function`);
          // No acknowledgment, just emit the event
          socket.listeners(event).forEach(handler => {
            try {
              handler(messageData);
            } catch (handlerError) {
              console.error(`Error in handler for ${event}:`, handlerError);
            }
          });
        }
      }
    } catch (error) {
      console.error('Error processing binary message:', error);
      // If there's an acknowledgment function, send an error
      if (typeof ack === 'function') {
        ack({ error: 'Failed to process message' });
      }
    }
  });
} */}

function setupBinaryTransmission(socket: Socket) {
  const clientId = socket.data?.clientId;
  const sessionId = socket.data?.sessionId;
  if (!clientId || !sessionId) return;
  
  const originalEmit = socket.emit;
  
  // Override emit to encrypt data when needed
  socket.emit = function(event: string, ...args: any[]): boolean {
    const payload = args[0];

    if (socket.data.encryptionReady) {
      // Encrypt the payload directly
      encryptAndPackMessage(clientId, sessionId, event, payload)
        .then(encryptedBuffer => {
          if (encryptedBuffer) {
            // Send encrypted buffer directly with the original event name
            //originalEmit.call(socket, event, encryptedBuffer, callback);
            originalEmit.call(socket, 'binary', encryptedBuffer, true);
          } else {
            // Fallback to unencrypted
            //originalEmit.call(socket, event, payload, callback);
            const binaryBuffer = Buffer.from(JSON.stringify({ event, data: payload }));
            originalEmit.call(socket, 'binary', binaryBuffer, false);
          }
        })
        .catch(error => {
          console.error(`Encryption error for ${event}:`, error);
          //originalEmit.call(socket, event, payload, callback);
          const binaryBuffer = Buffer.from(JSON.stringify({ event, data: payload }));
          originalEmit.call(socket, 'binary', binaryBuffer, false);
        });
    } else {
      // Send unencrypted
      //originalEmit.call(socket, event, payload, callback);
      const binaryBuffer = Buffer.from(JSON.stringify({ event, data: payload }));
      originalEmit.call(socket, 'binary', binaryBuffer, false);
    }

    return true;
  };

  // Use Socket.IO's public API for handling incoming events
  const onHandlers = new Map<string, Function[]>();
  const originalOn = socket.on;
  
{/*  socket.on = function(event: string, handler: Function): any {
    const wrappedHandler = async (data: any, ack?: Function) => {
      try {
        if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
          if (socket.data.encryptionReady) {
            const decrypted = await decryptAndUnpackMessage(clientId, sessionId, data);
            if (decrypted) {
              const wrapppedAck = ack ? async (response: any) => {
                if (socket.data.encryptionReady) {
                  try {
                    const encryptedBuffer = await encryptAndPackMessage(clientId, sessionId, event, response);
                    if (encryptedBuffer) {
                      ack(response);
                      return;
                    }
                  } catch (error) {
                    console.error(`Ack encryption error for ${event}:`, error);
                  }
                }
                ack(response)
              } : undefined
              handler(decrypted, wrapppedAck);
              return;
              //handler(decrypted, ack);
              //return;
            }
          }
        }
        // Handle regular or failed decryption cases
        handler(data, ack);
      } catch (error) {
        console.error(`Error handling event ${event}:`, error);
        if (typeof ack === 'function') {
          ack({ error: 'Internal server error' });
        }
      }
    };

    // Store the handler mapping
    if (!onHandlers.has(event)) {
      onHandlers.set(event, []);
    }
    onHandlers.get(event)?.push(handler);

    return originalOn.call(socket, event, wrappedHandler);
  }; */}

  socket.on('binary', async (data: Buffer | ArrayBuffer, isEncrypted: boolean) => {
    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  
      if (isEncrypted && socket.data.encryptionReady) {
        const message = await decryptAndUnpackMessage(clientId, sessionId, buffer);
        if (message) {
          const { event, data: messageData } = message;
          console.log(`Received encrypted binary message for event: ${event}`);
          
          // Emit the decrypted event and data
          socket.listeners(event).forEach(handler => {
            try {
              handler(messageData);
            } catch (handlerError) {
              console.error(`Error in handler for ${event}:`, handlerError);
            }
          });
        }
      } else {
        // Handle unencrypted binary data
        const { event, data: messageData } = JSON.parse(buffer.toString());
        console.log(`Received unencrypted binary message for event: ${event}`);

        socket.listeners(event).forEach(handler => {
          try {
            handler(messageData);
          } catch (handlerError) {
            console.error(`Error in handler for ${event}:`, handlerError);
          }
        });
      }
    } catch (error) {
      console.error('Error processing binary message:', error);
    }
  });

  return () => {
    // Cleanup function
    socket.emit = originalEmit;
    //socket.on = originalOn;
    onHandlers.clear();
  };
}

export const handleConnection = (
  io: Server,
  socket: Socket<any, any, any, SocketData>,
  redis: Redis,
  sessionStore: SessionStore 
) => {
  const { clientId, apiKey, socketId, sessionId } = socket.data;


  setupBinaryTransmission(socket);

  const updateSessionConnection = async (recovered: boolean = false) => {
    try {
      await sessionStore.updateConnectionStatus(sessionId, socketId, true);
      console.log(`${recovered ? 'Recovered' : 'New'} connection: Session ${sessionId} marked as connected`);
    } catch (error) {
      console.error('Error updating session connection status:', error);
    }
  };

  if (socket.recovered) {
    console.log(`Recovered connection for session ${sessionId}`);
    updateSessionConnection(true);
  } else {
    console.log(`New connection for session ${sessionId}`);
    updateSessionConnection();
  }

  console.log(`Sent session ID ${sessionId} to client ${clientId}`);

  // Store socket mapping in Redis
  const socketMapKey = `${apiKey}:${SOCKET_MAP_PREFIX}${socketId}`;
  const clientSocketsKey = `${apiKey}:${CLIENT_SOCKETS_PREFIX}${clientId}`;
  const apiKeyClientsKey = `${API_KEY_CLIENTS_PREFIX}${apiKey}`;


  // Using Promise.all for parallel Redis operations
  Promise.all([
    // Map socket to client info
    redis.hset(socketMapKey, {
      clientId,
      apiKey,
      socketId,
      sessionId
    }),
    redis.expire(socketMapKey, SOCKET_MAP_TTL),
    
    // Add socket to client's socket list
    redis.sadd(clientSocketsKey, socketId),
    
    // Add client to API key's client list
    redis.sadd(apiKeyClientsKey, clientId)
  ]).catch(err => {
    console.error('Redis connection state error:', err);
  });

  // Join API key room
  socket.join(`key:${apiKey}`);
  //socket.join(`client:${clientId}`);
  //socket.join(socket.data.clientId)
  socket.join(clientId);  



  return {
    cleanup: async () => {
      console.log(`Client ${clientId} disconnecting, cleaning up...`);
      
      try {
        // Get remaining sockets for this client
        const remainingSockets = await redis.srem(clientSocketsKey, socketId)
          .then(() => redis.smembers(clientSocketsKey));
        
        const isLastSocket = remainingSockets.length === 0;

        if (isLastSocket) {
          // Clean up all client data if this was the last socket
          await Promise.all([
            redis.del(clientSocketsKey),
            redis.srem(apiKeyClientsKey, clientId),
            // Check if this was the last client for this API key
            redis.smembers(apiKeyClientsKey).then(async (clients) => {
              if (clients.length === 0) {
                await redis.del(apiKeyClientsKey);
              }
            })
          ]);
        }

        // Always clean up socket mapping
        await redis.del(socketMapKey);
        
        console.log('Cleanup completed for client:', clientId);
        
        return {
          isLastSocket,
          leaveRoom: () => {
            socket.leave(`key:${apiKey}`);
            socket.leave(clientId);
          }
        };
      } catch (err) {
        console.error('Redis cleanup error:', err);
        return {
          isLastSocket: false,
          leaveRoom: () => {
            socket.leave(`key:${apiKey}`);
            socket.leave(clientId);
          }
        };
      }
    }
  };
};