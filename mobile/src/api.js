import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const TOKEN_KEY = 'roundtable.token';
let token = null;
let onSessionExpired = () => {};

export const getToken = () => token;

export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler;
}

export async function loadToken() {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token;
}

export async function setToken(value) {
  token = value;
  if (value) await SecureStore.setItemAsync(TOKEN_KEY, value);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers: { ...authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach the server', 0);
  }
  if (res.status === 401 && token && !path.startsWith('/auth/')) onSessionExpired();
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.error ?? 'Something went wrong', res.status);
  }
  return res.json();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Uses XHR because fetch has no upload progress. */
export function uploadFile(roomId, asset, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/rooms/${encodeURIComponent(roomId)}/files`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const data = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) resolve(data.file);
      else reject(new ApiError(data?.error ?? 'Upload failed', xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed', 0));
    const form = new FormData();
    form.append('file', {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? 'application/octet-stream',
    });
    xhr.send(form);
  });
}

/** Downloads into the app's cache, then hands the file to the system share sheet. */
export async function downloadAndShare(roomId, file) {
  const folder = new Directory(Paths.cache, file.id);
  folder.create({ idempotent: true, intermediates: true });
  const target = new File(folder, file.name);
  if (target.exists) target.delete();

  let saved;
  try {
    saved = await File.downloadFileAsync(
      `${API_URL}/api/rooms/${encodeURIComponent(roomId)}/files/${file.id}`,
      target,
      { headers: authHeaders() },
    );
  } catch {
    throw new ApiError('Download failed. You must be in the meeting to get its files.', 0);
  }
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(saved.uri, { dialogTitle: file.name });
  return saved;
}
