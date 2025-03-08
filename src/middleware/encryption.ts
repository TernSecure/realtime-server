import { box, randomBytes } from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';

// Generate server keypair once at startup
const serverKeyPair = box.keyPair();

// Store client public keys
const clientPublicKeys = new Map<string, Uint8Array>();

export const generateKeyPair = () => {
  return encodeBase64(serverKeyPair.publicKey);
};

export const getServerPublicKey = (): string => {
  return encodeBase64(serverKeyPair.publicKey);
};

export const setClientPublicKey = (clientId: string, publicKeyBase64: string): void => {
  const publicKey = decodeBase64(publicKeyBase64);
  clientPublicKeys.set(clientId, publicKey);
};

export const hasClientPublicKey = (clientId: string): boolean => {
  return clientPublicKeys.has(clientId);
};

export const encryptForClient = (clientId: string, message: any): string | null => {
  const clientPublicKey = clientPublicKeys.get(clientId);
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

export const decryptFromClient = (clientId: string, encryptedBase64: string): any | null => {
  const clientPublicKey = clientPublicKeys.get(clientId);
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