import { encryptForClient, decryptFromClient } from './encryption';

export async function encryptAndPackMessage(
  clientId: string, 
  sessionId: string, 
  event: string, 
  data: any
): Promise<ArrayBuffer | null >{
  try {
    const message = { event, data };
    const jsonString = JSON.stringify(message);
    
    // Encrypt the entire message
    const encryptedBase64 = await encryptForClient(clientId, sessionId, jsonString);
    if (!encryptedBase64) return null;
    
    // Convert base64 to binary
    const binaryString = atob(encryptedBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    return bytes.buffer;
  } catch (error) {
    console.error('Error encrypting message:', error);
    return null;
  }
}

export async function decryptAndUnpackMessage(
  clientId: string,
  sessionId: string,
  binaryData: ArrayBuffer
): Promise<{ event: string, data: any } | null> {
  try {
    // Convert binary to base64
    const bytes = new Uint8Array(binaryData);
    let binaryString = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binaryString += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binaryString);
    
    // Decrypt the message
    const decrypted = await decryptFromClient(clientId, sessionId, base64);
    if (!decrypted) return null;
    
    // Add debug logs
    console.log('Decrypted message before parsing:', decrypted);
    
    // Make sure we're parsing a string, not an object
    const jsonString = typeof decrypted === 'string' ? decrypted : JSON.stringify(decrypted);
    
    // Parse the JSON
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Error decrypting message:', error);
    console.error('Decryption input:', { clientId, sessionId });
    return null;
  }
}