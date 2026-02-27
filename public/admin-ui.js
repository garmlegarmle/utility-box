(() => {
  const COLLECTIONS = ['blog', 'tools', 'games', 'pages'];

  function parseRoute() {
    const segments = window.location.pathname.split('/').filter(Boolean);
    const lang = segments[0] === 'en' || segments[0] === 'ko' ? segments[0] : 'en';
    const collection = COLLECTIONS.includes(segments[1]) ? segments[1] : null;
    const slug = collection && segments[2] ? segments[2] : null;
    return { lang, collection, slug };
  }

  function shouldShowLoginButton() {
    const url = new URL(window.location.href);
    return url.searchParams.get('admin') === '1';
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  async function apiGet(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed: ${response.status}`);
    }
    return data;
  }

  async function apiPost(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `Request failed: ${response.status}`);
    }

    return data;
  }

  function ensureHost() {
    let host = document.querySelector('.admin-host');
    if (host) return host;

    host = document.createElement('div');
    host.className = 'admin-host';
    document.body.appendChild(host);
    return host;
  }

  function clearHost() {
    const host = document.querySelector('.admin-host');
    if (host) {
      host.innerHTML = '';
    }
  }

  function closeModal() {
    const modal = document.querySelector('.admin-modal');
    if (!modal) return;

    window.removeEventListener('keydown', modal.__onEsc);
    modal.remove();
  }

  function createModal(title) {
    closeModal();

    const modal = document.createElement('div');
    modal.className = 'admin-modal';
    modal.innerHTML = `
      <div class="admin-modal__backdrop" data-close="1"></div>
      <div class="admin-modal__panel" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="admin-modal__header">
          <h2>${title}</h2>
          <button type="button" class="admin-modal__close" aria-label="Close">x</button>
        </div>
        <div class="admin-modal__body"></div>
      </div>
    `;

    const onEsc = (event) => {
      if (event.key === 'Escape') {
        closeModal();
      }
    };

    modal.__onEsc = onEsc;
    window.addEventListener('keydown', onEsc);

    modal.querySelector('.admin-modal__close')?.addEventListener('click', closeModal);
    modal.querySelector('.admin-modal__backdrop')?.addEventListener('click', closeModal);

    document.body.appendChild(modal);
    return modal.querySelector('.admin-modal__body');
  }

  function openAuthPopup() {
    const redirect = `${window.location.pathname}${window.location.search || '?admin=1'}`;
    const authUrl = `/api/auth?redirect=${encodeURIComponent(redirect)}`;
    window.open(authUrl, 'ubAdminAuth', 'width=620,height=760');
  }

  function resolvePathCandidates(path) {
    const normalized = String(path || '').trim().replace(/^\/+/, '');
    if (!normalized) return [];
    if (/\.(md|mdx)$/i.test(normalized)) return [normalized];
    return [`${normalized}.mdx`, `${normalized}.md`];
  }

  async function loadContentFile(path) {
    const candidates = resolvePathCandidates(path);

    for (const candidate of candidates) {
      try {
        const file = await apiGet(`/api/content?path=${encodeURIComponent(candidate)}`);
        return { ...file, path: candidate };
      } catch (error) {
        if (!/not found/i.test(error.message || '')) {
          throw error;
        }
      }
    }

    throw new Error('File not found');
  }

  function yamlQuote(value) {
    return JSON.stringify(String(value ?? ''));
  }

  function buildEntryTemplate(collection, values) {
    const title = values.title || 'Untitled';
    const description = values.description || 'Description';
    const slug = values.slug;
    const lang = values.lang;
    const category = values.category || '';
    const tags = values.tags
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const lines = [
      '---',
      `title: ${yamlQuote(title)}`,
      `description: ${yamlQuote(description)}`,
      `slug: ${yamlQuote(slug)}`,
      `lang: ${yamlQuote(lang)}`
    ];

    if (collection === 'blog') {
      lines.push(`date: ${new Date().toISOString().slice(0, 10)}`);
    }

    if (category) {
      lines.push(`category: ${yamlQuote(category)}`);
    }

    if (tags.length > 0) {
      lines.push('tags:');
      tags.forEach((tag) => lines.push(`  - ${yamlQuote(tag)}`));
    }

    lines.push('---', '', values.body || 'Write your content here.');
    return `${lines.join('\n')}\n`;
  }

  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `admin-toast${isError ? ' error' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  async function openEditor(path) {
    try {
      const file = await loadContentFile(path);
      const body = createModal(`Edit ${file.path}`);
      if (!body) return;

      body.innerHTML = `
        <label class="admin-field">
          <span>Commit message</span>
          <input type="text" class="admin-input" value="Edit ${file.path}" />
        </label>
        <label class="admin-field">
          <span>Content</span>
          <textarea class="admin-textarea"></textarea>
        </label>
        <div class="admin-actions">
          <button type="button" class="admin-btn admin-btn--secondary" data-cancel>Cancel</button>
          <button type="button" class="admin-btn" data-save>Save</button>
        </div>
      `;

      const textarea = body.querySelector('.admin-textarea');
      if (textarea) {
        textarea.value = file.content || '';
      }

      body.querySelector('[data-cancel]')?.addEventListener('click', closeModal);

      body.querySelector('[data-save]')?.addEventListener('click', async () => {
        const message = body.querySelector('.admin-input')?.value.trim() || `Edit ${file.path}`;
        const content = textarea?.value ?? '';

        try {
          await apiPost('/api/content', { path: file.path, message, content });
          closeModal();
          showToast('Saved. The site will redeploy shortly.');
          setTimeout(() => window.location.reload(), 800);
        } catch (error) {
          showToast(error.message || 'Save failed', true);
        }
      });
    } catch (error) {
      showToast(error.message || 'Failed to load file', true);
    }
  }

  function openCreateDialog(collection, lang) {
    const body = createModal(`Add ${collection}`);
    if (!body) return;

    body.innerHTML = `
      <label class="admin-field">
        <span>Title</span>
        <input class="admin-input" name="title" type="text" />
      </label>
      <label class="admin-field">
        <span>Slug</span>
        <input class="admin-input" name="slug" type="text" />
      </label>
      <label class="admin-field">
        <span>Description</span>
        <input class="admin-input" name="description" type="text" />
      </label>
      <label class="admin-field">
        <span>Category (optional)</span>
        <input class="admin-input" name="category" type="text" />
      </label>
      <label class="admin-field">
        <span>Tags (comma separated, optional)</span>
        <input class="admin-input" name="tags" type="text" />
      </label>
      <label class="admin-field">
        <span>Body</span>
        <textarea class="admin-textarea" name="body">Write your content here.</textarea>
      </label>
      <div class="admin-actions">
        <button type="button" class="admin-btn admin-btn--secondary" data-cancel>Cancel</button>
        <button type="button" class="admin-btn" data-save>Create</button>
      </div>
    `;

    const titleInput = body.querySelector('input[name="title"]');
    const slugInput = body.querySelector('input[name="slug"]');

    titleInput?.addEventListener('input', () => {
      if (!slugInput.dataset.touched) {
        slugInput.value = slugify(titleInput.value);
      }
    });

    slugInput?.addEventListener('input', () => {
      slugInput.dataset.touched = '1';
    });

    body.querySelector('[data-cancel]')?.addEventListener('click', closeModal);

    body.querySelector('[data-save]')?.addEventListener('click', async () => {
      const values = {
        title: body.querySelector('input[name="title"]')?.value.trim() || '',
        slug: slugify(body.querySelector('input[name="slug"]')?.value.trim() || ''),
        description: body.querySelector('input[name="description"]')?.value.trim() || '',
        category: body.querySelector('input[name="category"]')?.value.trim() || '',
        tags: body.querySelector('input[name="tags"]')?.value || '',
        body: body.querySelector('textarea[name="body"]')?.value || '',
        lang
      };

      if (!values.title || !values.slug) {
        showToast('Title and slug are required.', true);
        return;
      }

      const path = `src/content/${collection}/${lang}/${values.slug}.mdx`;
      const content = buildEntryTemplate(collection, values);

      try {
        await apiPost('/api/content', {
          path,
          message: `Create ${collection}: ${values.slug}`,
          content
        });

        closeModal();
        showToast('Created. Redirecting...');
        setTimeout(() => {
          window.location.href = `/${lang}/${collection}/${values.slug}/`;
        }, 500);
      } catch (error) {
        showToast(error.message || 'Create failed', true);
      }
    });
  }

  function attachCardEditButtons() {
    document.querySelectorAll('.admin-edit-trigger[data-admin-file]').forEach((button) => {
      if (button.dataset.bound) return;
      button.dataset.bound = '1';

      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const path = button.getAttribute('data-admin-file');
        if (path) {
          openEditor(path);
        }
      });
    });
  }

  function renderAdminMenu(session) {
    clearHost();

    const host = ensureHost();
    const route = parseRoute();

    const wrapper = document.createElement('div');
    wrapper.className = 'admin-fab-wrap';
    wrapper.innerHTML = `
      <button type="button" class="admin-fab" aria-label="Admin menu">+</button>
      <div class="admin-menu" hidden>
        <p class="admin-menu__user">${session.username}</p>
        <button type="button" data-action="edit-page">Edit current content</button>
        <button type="button" data-action="add-current">Add in this section</button>
        <button type="button" data-action="add-blog">Add blog post</button>
        <button type="button" data-action="add-tools">Add tool card</button>
        <button type="button" data-action="add-games">Add game card</button>
        <button type="button" data-action="add-pages">Add page</button>
        <button type="button" data-action="logout">Logout</button>
      </div>
    `;

    const fab = wrapper.querySelector('.admin-fab');
    const menu = wrapper.querySelector('.admin-menu');

    fab?.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
    });

    wrapper.querySelectorAll('button[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.getAttribute('data-action');
        menu.hidden = true;

        if (action === 'logout') {
          try {
            await apiPost('/api/logout', {});
            window.location.reload();
          } catch (error) {
            showToast(error.message || 'Logout failed', true);
          }
          return;
        }

        if (action === 'edit-page') {
          const direct = document.querySelector('[data-admin-page-file]')?.getAttribute('data-admin-page-file');
          if (direct) {
            openEditor(direct);
          } else {
            showToast('This page is a generated listing. Use card edit buttons.', true);
          }
          return;
        }

        if (action === 'add-current') {
          if (!route.collection) {
            showToast('Open a list page first (blog/tools/games/pages).', true);
            return;
          }
          openCreateDialog(route.collection, route.lang);
          return;
        }

        if (action?.startsWith('add-')) {
          const collection = action.replace('add-', '');
          if (COLLECTIONS.includes(collection)) {
            openCreateDialog(collection, route.lang);
          }
        }
      });
    });

    host.appendChild(wrapper);
  }

  function renderLoginButton() {
    clearHost();
    const host = ensureHost();

    const button = document.createElement('button');
    button.className = 'admin-login-btn';
    button.type = 'button';
    button.textContent = 'Admin Login';
    button.addEventListener('click', openAuthPopup);

    host.appendChild(button);
  }

  async function init() {
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'ub-admin-auth-success') return;
      if (event.data.ok) {
        window.location.reload();
      } else {
        showToast(event.data.message || 'Authentication failed', true);
      }
    });

    let session;
    try {
      session = await apiGet('/api/session');
    } catch {
      session = { authenticated: false, isAdmin: false };
    }

    if (!session.authenticated || !session.isAdmin) {
      if (shouldShowLoginButton()) {
        renderLoginButton();
      }
      return;
    }

    document.body.classList.add('admin-mode');
    renderAdminMenu(session);
    attachCardEditButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
