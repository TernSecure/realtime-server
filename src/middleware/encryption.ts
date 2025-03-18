import { box, randomBytes } from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';
import { SessionStore } from '../types';
import { Redis } from 'ioredis';

let sessionStore: SessionStore;
let redis: Redis;
let serverKeyPair = box.keyPair();

const SERVER_KEYS_KEY = 'server:keypair';

export const initializeEncryption = async (store: SessionStore, redisClient: Redis) => {
  sessionStore = store;
  redis = redisClient;

  const storedKeys = await redis.get(SERVER_KEYS_KEY);
  if (storedKeys) {
    try {
      const { publicKey, secretKey } = JSON.parse(storedKeys);
      serverKeyPair = {
        publicKey: decodeBase64(publicKey),
        secretKey: decodeBase64(secretKey)
      };
      console.log('Loaded existing server keypair');
    } catch (error) {
      console.error('Error loading server keys, generating new ones:', error);
      generateAndStoreNewKeys();
    }
  } else {
    generateAndStoreNewKeys();
  }
};

const generateAndStoreNewKeys = async () => {
  serverKeyPair = box.keyPair();
  
  // Store the new keys in Redis
  await redis.set(SERVER_KEYS_KEY, JSON.stringify({
    publicKey: encodeBase64(serverKeyPair.publicKey),
    secretKey: encodeBase64(serverKeyPair.secretKey)
  }));
  
  console.log('Generated and stored new server keypair');
};


export const getServerPublicKey = (): string => {
  return encodeBase64(serverKeyPair.publicKey);
};

export const getClientPublicKey = async (clientId: string, sessionId: string): Promise<Uint8Array | null> => {
  try {
    const session = await sessionStore.findSession(sessionId);
    
    if (!session || !session.clientPublicKey || !session.encryptionReady) {
      console.warn(`No encryption ready session found for sessionId ${sessionId}`);
      return null;
    }

    return decodeBase64(session.clientPublicKey);
  } catch (error) {
    console.error('Error getting client public key:', error);
    return null;
  }
};


export const hasClientPublicKey = async (clientId: string, sessionId: string): Promise<boolean> => {
  try {
    const session = await sessionStore.findSession(sessionId);
    return !!(session?.clientPublicKey && session?.encryptionReady);
  } catch (error) {
    console.error('Error checking client public key:', error);
    return false;
  }
};

export const encryptForClient = async (clientId: string, sessionId: string, message: any): Promise<string | null> => {
  const clientPublicKey = await getClientPublicKey(clientId, sessionId);
  if (!clientPublicKey) return null;

  const messageString = typeof message === 'string' ? message : JSON.stringify(message);
  const messageUint8 = decodeUTF8(messageString);
  
  // Generate a one-time nonce
  const nonce = randomBytes(box.nonceLength);
  
  // Encrypt the message
  const encrypted = box(
    messageUint8,
    nonce,
    clientPublicKey,
    serverKeyPair.secretKey
  );
  
  // Combine nonce and encrypted message
  const fullMessage = new Uint8Array(nonce.length + encrypted.length);
  fullMessage.set(nonce);
  fullMessage.set(encrypted, nonce.length);
  
  // Return as base64 string
  return encodeBase64(fullMessage);
};

export const decryptFromClient = async (clientId: string, sessionId: string, encryptedBase64: string): Promise<any | null> => {
  const clientPublicKey = await getClientPublicKey(clientId, sessionId);
  if (!clientPublicKey) return null;
  
  // Decode the message from base64
  const encryptedMessage = decodeBase64(encryptedBase64);
  
  // Extract the nonce
  const nonce = encryptedMessage.slice(0, box.nonceLength);
  const ciphertext = encryptedMessage.slice(box.nonceLength);
  
  // Decrypt the message
  const decrypted = box.open(
    ciphertext,
    nonce,
    clientPublicKey,
    serverKeyPair.secretKey
  );
  
  if (!decrypted) return null;
  
  // Convert to string
  const messageString = encodeUTF8(decrypted);
  
  // Try to parse as JSON, return as string if not valid JSON
  try {
    return JSON.parse(messageString);
  } catch (e) {
    return messageString;
  }
};