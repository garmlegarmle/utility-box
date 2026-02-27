function encodeContentPath(path) {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function decodeBase64Content(base64Content) {
  const normalized = base64Content.replace(/\n/g, '');
  return decodeURIComponent(escape(atob(normalized)));
}

function encodeBase64Content(content) {
  return btoa(unescape(encodeURIComponent(content)));
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function parseRepo(env) {
  const repo = env.GITHUB_REPO || 'garmlegarmle/utility-box';
  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    throw new Error('Invalid GITHUB_REPO format. Expected owner/repo');
  }

  return {
    owner,
    repo: name,
    branch: env.GITHUB_BRANCH || 'main'
  };
}

export async function githubRequest(token, url, init = {}) {
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'utility-box-admin-ui',
    ...authHeader,
    ...init.headers
  };

  const response = await fetch(url, {
    ...init,
    headers
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    text
  };
}

export async function getRepoFile(token, owner, repo, branch, path) {
  const contentPath = encodeContentPath(path);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${contentPath}?ref=${encodeURIComponent(branch)}`;
  const response = await githubRequest(token, url);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok || !response.data) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }

  const content = decodeBase64Content(response.data.content || '');

  return {
    sha: response.data.sha,
    content
  };
}

export async function getRepoFileRaw(token, owner, repo, branch, path) {
  const contentPath = encodeContentPath(path);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${contentPath}?ref=${encodeURIComponent(branch)}`;
  const response = await githubRequest(token, url);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok || !response.data) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }

  return {
    sha: response.data.sha,
    contentBase64: (response.data.content || '').replace(/\n/g, '')
  };
}

export async function upsertRepoFile(token, owner, repo, branch, path, content, message, sha) {
  const contentPath = encodeContentPath(path);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${contentPath}`;

  const body = {
    message,
    content: encodeBase64Content(content),
    branch,
    ...(sha ? { sha } : {})
  };

  const response = await githubRequest(token, url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Failed to save file: ${response.status} ${response.text}`);
  }

  return response.data;
}

export async function upsertRepoBinaryFile(token, owner, repo, branch, path, contentBase64, message, sha) {
  const contentPath = encodeContentPath(path);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${contentPath}`;

  const body = {
    message,
    content: contentBase64,
    branch,
    ...(sha ? { sha } : {})
  };

  const response = await githubRequest(token, url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Failed to save binary file: ${response.status} ${response.text}`);
  }

  return response.data;
}

export async function deleteRepoFile(token, owner, repo, branch, path, message, sha) {
  const contentPath = encodeContentPath(path);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${contentPath}`;

  const body = {
    message,
    sha,
    branch
  };

  const response = await githubRequest(token, url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Failed to delete file: ${response.status} ${response.text}`);
  }

  return response.data;
}
