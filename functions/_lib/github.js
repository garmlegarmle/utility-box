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
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'utility-box-admin-ui',
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
