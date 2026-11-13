const TOKEN_KEY = 'roundtable.token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorFrom(res) {
  const body = await res.json().catch(() => null);
  return new ApiError(body?.error ?? 'Something went wrong', res.status);
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach the server', 0);
  }
  if (res.status === 401 && getToken() && !path.startsWith('/auth/')) {
    // The session expired while the app was open.
    setToken(null);
    window.location.assign('/login');
  }
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

/** Uses XHR because fetch has no upload progress. */
export function uploadFile(roomId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/rooms/${encodeURIComponent(roomId)}/files`);
    xhr.responseType = 'json';
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response.file);
      else reject(new ApiError(xhr.response?.error ?? 'Upload failed', xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed', 0));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

/** The download needs the auth header, so it goes through a blob instead of a plain link. */
export async function downloadFile(roomId, file) {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/files/${file.id}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw await errorFrom(res);
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
