import { addLogEntry } from './aiLogService';
import { type User } from '../types';
import { supabase } from './supabaseClient';

// Default fallback servers if session is empty
const FALLBACK_SERVERS = [
    'https://s1.monoklix.com', 'https://s2.monoklix.com', 'https://s3.monoklix.com',
    'https://s4.monoklix.com', 'https://s5.monoklix.com', 'https://s6.monoklix.com',
    'https://s7.monoklix.com', 'https://s8.monoklix.com', 'https://s9.monoklix.com',
    'https://s10.monoklix.com'
];

export const getVeoProxyUrl = (): string => {
  if (window.location.hostname === 'localhost') {
    return 'http://localhost:3001';
  }
  const userSelectedProxy = sessionStorage.getItem('selectedProxyServer');
  if (userSelectedProxy) {
      return userSelectedProxy;
  }
  // Default if nothing selected
  return 'https://veox.monoklix.com';
};

export const getImagenProxyUrl = (): string => {
  if (window.location.hostname === 'localhost') {
    return 'http://localhost:3001';
  }
  const userSelectedProxy = sessionStorage.getItem('selectedProxyServer');
  if (userSelectedProxy) {
      return userSelectedProxy;
  }
  return 'https://gemx.monoklix.com';
};

const getPersonalToken = (): { token: string; createdAt: string; } | null => {
    try {
        const userJson = localStorage.getItem('currentUser');
        if (userJson) {
            const user = JSON.parse(userJson);
            if (user && user.personalAuthToken) {
                return { token: user.personalAuthToken, createdAt: 'personal' };
            }
        }
    } catch (e) {
        console.error("Could not parse user from localStorage to get personal token", e);
    }
    return null;
};

// Helper to get tokens from the shared pool based on service type
const getSharedTokensFromSession = (serviceType: 'veo' | 'imagen'): { token: string; createdAt: string }[] => {
    try {
        const key = serviceType === 'veo' ? 'veoAuthTokens' : 'imagenAuthTokens';
        const tokensJSON = sessionStorage.getItem(key);
        if (tokensJSON) {
            const parsed = JSON.parse(tokensJSON);
            if (Array.isArray(parsed)) {
                // Sort by newest first
                return parsed.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            }
        }
    } catch (e) {
        console.warn(`Failed to parse ${serviceType} tokens from session:`, e);
    }
    return [];
};


const getCurrentUserInternal = (): User | null => {
    try {
        const savedUserJson = localStorage.getItem('currentUser');
        if (savedUserJson) {
            const user = JSON.parse(savedUserJson) as User;
            if (user && user.id) {
                return user;
            }
        }
    } catch (error) {
        console.error("Failed to parse user from localStorage for activity log.", error);
    }
    return null;
};

// --- EXECUTE REQUEST WITH ROBUST FAILOVER ---

interface RequestAttempt {
    token: string;
    serverUrl: string;
    source: 'Specific' | 'Personal' | 'Pool';
}

export const executeProxiedRequest = async (
  relativePath: string,
  serviceType: 'veo' | 'imagen',
  requestBody: any,
  logContext: string,
  specificToken?: string,
  onStatusUpdate?: (status: string) => void,
  overrideServerUrl?: string // New parameter to force a specific server
): Promise<{ data: any; successfulToken: string }> => {
  console.log(`[API Client] Starting process for: ${logContext}`);
  
  // Use override URL if provided, otherwise default to standard proxy selection
  const currentServerUrl = overrideServerUrl || (serviceType === 'veo' ? getVeoProxyUrl() : getImagenProxyUrl());
  const tokenMode = sessionStorage.getItem('monoklix_token_mode');

  // 1. Acquire Server Slot (Rate Limiting at Server Level)
  const isGenerationRequest = logContext.includes('GENERATE') || logContext.includes('RECIPE');
  
  if (isGenerationRequest) {
    if (onStatusUpdate) onStatusUpdate('Queueing...');
    await supabase.rpc('request_generation_slot', { cooldown_seconds: 10, server_url: currentServerUrl });
    if (onStatusUpdate) onStatusUpdate('Processing...');
  }
  
  // 2. Build Attempt Strategy List
  let attempts: RequestAttempt[] = [];
  const usedAttempts = new Set<string>(); // To prevent duplicate token+server pairs

  const addAttempt = (attempt: RequestAttempt) => {
      const key = `${attempt.token.slice(-6)}@${attempt.serverUrl}`;
      if (!usedAttempts.has(key)) {
          attempts.push(attempt);
          usedAttempts.add(key);
      }
  };

  if (specificToken) {
      // SCENARIO A: Strict Mode (Health Check or multi-step process)
      // If overrideServerUrl is present, use it. Otherwise use currentServerUrl.
      addAttempt({ token: specificToken, serverUrl: currentServerUrl, source: 'Specific' });
  } else if (tokenMode === 'personal_only') {
      // SCENARIO B: Personal Token Only Mode
      const personal = getPersonalToken();
      if (!personal) {
          throw new Error("Personal Token Only mode is active, but no personal token is set.");
      }
      addAttempt({ token: personal.token, serverUrl: currentServerUrl, source: 'Personal' });
  } else {
      // SCENARIO C: Hybrid "Bulletproof" Mode (Default)
      const personal = getPersonalToken();
      const allSharedTokens = getSharedTokensFromSession(serviceType);
      const newestPoolTokens = allSharedTokens.slice(0, 10);
      const shuffledPool = [...newestPoolTokens].sort(() => 0.5 - Math.random());

      // PHASE 1: Try on Current (or Overridden) Server
      if (personal) {
          addAttempt({ token: personal.token, serverUrl: currentServerUrl, source: 'Personal' });
      }
      shuffledPool.forEach(t => {
          addAttempt({ token: t.token, serverUrl: currentServerUrl, source: 'Pool' });
      });

      // PHASE 2: Try on Backup Servers (Only if NOT overriding server)
      // If overrideServerUrl is set, we strictly want THAT server (e.g., for parallel processing specific slots)
      if (!overrideServerUrl) {
          const otherServers = FALLBACK_SERVERS.filter(s => s !== currentServerUrl);
          const backupServers = [...otherServers].sort(() => 0.5 - Math.random()).slice(0, 2);

          backupServers.forEach(backupServer => {
              if (personal) {
                  addAttempt({ token: personal.token, serverUrl: backupServer, source: 'Personal' });
              }
              shuffledPool.slice(0, 3).forEach(t => {
                  addAttempt({ token: t.token, serverUrl: backupServer, source: 'Pool' });
              });
          });
      }
  }

  if (attempts.length === 0) {
      throw new Error(`No authentication tokens found. Please claim a token in Settings.`);
  }

  const currentUser = getCurrentUserInternal();
  let lastError: any = new Error("Unknown error");

  // 3. Execute the Strategy Loop
  for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const isLastAttempt = i === attempts.length - 1;
      
      try {
          const endpoint = `${attempt.serverUrl}/api/${serviceType}${relativePath}`;
          console.log(`[API Client] Attempt ${i + 1}/${attempts.length} | ${attempt.source} Token | Server: ${attempt.serverUrl}`);

          const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${attempt.token}`,
                  'x-user-username': currentUser?.username || 'unknown',
              },
              body: JSON.stringify(requestBody),
          });

          let data;
          const textResponse = await response.text();
          try {
              data = JSON.parse(textResponse);
          } catch {
              data = { error: { message: `Proxy returned non-JSON (${response.status})` } };
          }

          if (!response.ok) {
              const status = response.status;
              const errorMessage = data.error?.message || data.message || `API call failed (${status})`;
              const lowerMsg = errorMessage.toLowerCase();

              if (status === 400 || lowerMsg.includes('safety') || lowerMsg.includes('blocked')) {
                  console.warn(`[API Client] 🛑 Non-retriable error (${status}). Prompt issue.`);
                  throw new Error(errorMessage);
              }

              console.warn(`[API Client] ⚠️ Attempt ${i + 1} failed (${status}). Trying next...`);
              if (isLastAttempt) throw new Error(errorMessage);
              continue;
          }

          console.log(`✅ [API Client] Success using ${attempt.source} token on ${attempt.serverUrl}`);
          return { data, successfulToken: attempt.token };

      } catch (error) {
          lastError = error;
          const errMsg = error instanceof Error ? error.message : String(error);
          if (errMsg.includes('400') || errMsg.toLowerCase().includes('safety')) {
              throw error;
          }

          if (isLastAttempt) {
              console.error(`❌ [API Client] All ${attempts.length} attempts exhausted.`);
              if (!specificToken) {
                  addLogEntry({ 
                      model: logContext, 
                      prompt: `Failed after ${attempts.length} attempts`, 
                      output: errMsg, 
                      tokenCount: 0, 
                      status: 'Error', 
                      error: errMsg 
                  });
              }
              throw lastError;
          }
      }
  }

  throw lastError;
};