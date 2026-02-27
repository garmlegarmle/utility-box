(() => {
  const COLLECTIONS = ['blog', 'tools', 'games', 'pages'];
  const WRITABLE_POST_COLLECTIONS = ['blog', 'tools', 'games'];
  const ADMIN_MODE_KEY = 'ub_admin_mode';

  function parseRoute() {
    const segments = window.location.pathname.split('/').filter(Boolean);
    const lang = segments[0] === 'en' || segments[0] === 'ko' ? segments[0] : 'en';
    const collection = COLLECTIONS.includes(segments[1]) ? segments[1] : null;
    const slug = collection && segments[2] ? segments[2] : null;
    return { lang, collection, slug };
  }

  function shouldShowLoginButton() {
    const url = new URL(window.location.href);
    return url.searchParams.get('admin') === '8722';
  }

  function isAdminModeRequested() {
    try {
      if (shouldShowLoginButton()) return true;
      return window.localStorage.getItem(ADMIN_MODE_KEY) === '1';
    } catch {
      return shouldShowLoginButton();
    }
  }

  function setAdminMode(enabled) {
    try {
      if (enabled) window.localStorage.setItem(ADMIN_MODE_KEY, '1');
      else window.localStorage.removeItem(ADMIN_MODE_KEY);
    } catch {
      // ignore
    }
  }

  function mapCollectionToPostCategory(collection) {
    if (collection === 'blog') return 'blog';
    if (collection === 'tools') return 'tool';
    if (collection === 'games') return 'game';
    return '';
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return char;
      }
    });
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
    if (host) host.innerHTML = '';
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
      <div class="admin-modal__panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="admin-modal__header">
          <h2>${escapeHtml(title)}</h2>
          <button type="button" class="admin-modal__close" aria-label="Close">x</button>
        </div>
        <div class="admin-modal__body"></div>
      </div>
    `;

    const onEsc = (event) => {
      if (event.key === 'Escape') closeModal();
    };

    modal.__onEsc = onEsc;
    window.addEventListener('keydown', onEsc);

    modal.querySelector('.admin-modal__close')?.addEventListener('click', closeModal);
    modal.querySelector('.admin-modal__backdrop')?.addEventListener('click', closeModal);

    document.body.appendChild(modal);
    return modal.querySelector('.admin-modal__body');
  }

  function openAuthPopup() {
    const url = new URL(window.location.href);
    url.searchParams.set('admin', '8722');
    const redirect = `${url.pathname}${url.search}`;
    const authUrl = `/api/auth?redirect=${encodeURIComponent(redirect)}`;
    window.open(authUrl, 'ubAdminAuth', 'width=620,height=760');
  }

  function openPostWriter(lang, category) {
    const safeLang = lang === 'ko' ? 'ko' : 'en';
    const safeCategory = ['blog', 'tool', 'game'].includes(category) ? category : '';
    const detail = {
      lang: safeLang,
      category: safeCategory,
      opened: false
    };

    window.dispatchEvent(
      new CustomEvent('ub:open-post-editor', {
        detail
      })
    );

    if (!detail.opened) {
      const section =
        safeCategory === 'tool' ? 'tools' : safeCategory === 'game' ? 'games' : 'blog';
      const fallbackCategory = safeCategory || 'blog';
      const url = new URL(`/${safeLang}/${section}/`, window.location.origin);
      url.searchParams.set('admin', '8722');
      url.searchParams.set('compose', '1');
      url.searchParams.set('category', fallbackCategory);
      window.location.href = `${url.pathname}?${url.searchParams.toString()}`;
    }
  }

  function openLoginDialog() {
    const body = createModal('Admin Login');
    if (!body) return;

    body.innerHTML = `
      <div class="admin-compose">
        <h3 class="admin-compose__title">관리자 로그인</h3>
        <p class="notice-board__state">GitHub 계정으로 로그인 후 관리자 권한이 허용된 계정만 편집할 수 있습니다.</p>
        <div class="admin-actions">
          <button type="button" class="admin-btn admin-btn--secondary" data-action="cancel">Cancel</button>
          <button type="button" class="admin-btn" data-action="login">Login with GitHub</button>
        </div>
      </div>
    `;

    body.querySelector('[data-action="cancel"]')?.addEventListener('click', closeModal);
    body.querySelector('[data-action="login"]')?.addEventListener('click', () => {
      closeModal();
      openAuthPopup();
    });
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

  function unquoteYaml(value) {
    const raw = String(value ?? '').trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    return raw;
  }

  function parseTagsInput(value) {
    return String(value || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  function splitFrontmatter(content) {
    const match = String(content || '').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return null;

    return {
      frontmatter: match[1],
      body: match[2]
    };
  }

  function parseFrontmatterText(frontmatterText) {
    const meta = {};
    const lines = String(frontmatterText || '').split('\n');
    let listKey = null;

    for (const line of lines) {
      if (!line.trim()) continue;

      const listItem = line.match(/^\s*-\s*(.+)\s*$/);
      if (listItem && listKey) {
        if (!Array.isArray(meta[listKey])) meta[listKey] = [];
        meta[listKey].push(unquoteYaml(listItem[1]));
        continue;
      }

      const keyMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (!keyMatch) {
        listKey = null;
        continue;
      }

      const key = keyMatch[1];
      const rawValue = keyMatch[2].trim();

      if (!rawValue) {
        if (key === 'tags') {
          meta[key] = [];
          listKey = key;
        } else {
          meta[key] = '';
          listKey = null;
        }
        continue;
      }

      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        meta[key] = rawValue
          .slice(1, -1)
          .split(',')
          .map((item) => unquoteYaml(item))
          .filter(Boolean);
      } else {
        meta[key] = unquoteYaml(rawValue);
      }

      listKey = null;
    }

    return meta;
  }

  function buildFrontmatterDocument(meta, body) {
    const required = {
      title: meta.title || 'Untitled',
      description: meta.description || meta.title || 'Description',
      slug: meta.slug || slugify(meta.title || 'untitled'),
      lang: meta.lang || 'en'
    };

    const merged = { ...meta, ...required };
    const preferredOrder = [
      'title',
      'description',
      'slug',
      'lang',
      'date',
      'category',
      'tags',
      'pairSlug',
      'heroImage',
      'cardImage',
      'image'
    ];

    const allKeys = Object.keys(merged);
    const orderedKeys = [
      ...preferredOrder.filter((key) => allKeys.includes(key)),
      ...allKeys.filter((key) => !preferredOrder.includes(key))
    ];

    const lines = ['---'];

    for (const key of orderedKeys) {
      const value = merged[key];

      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        lines.push(`${key}:`);
        value.forEach((item) => lines.push(`  - ${yamlQuote(item)}`));
        continue;
      }

      if (value === undefined || value === null) continue;
      const text = String(value).trim();
      if (!text) continue;

      if (key === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
        lines.push(`${key}: ${text}`);
      } else {
        lines.push(`${key}: ${yamlQuote(text)}`);
      }
    }

    const normalizedBody = String(body || '').replace(/^\n+/, '');
    lines.push('---', '', normalizedBody);
    return `${lines.join('\n')}\n`;
  }

  function buildEntryTemplate(collection, values) {
    const tags = parseTagsInput(values.tags || '');
    const meta = {
      title: values.title || 'Untitled',
      description: values.description || 'Description',
      slug: values.slug,
      lang: values.lang,
      ...(collection === 'blog' ? { date: new Date().toISOString().slice(0, 10) } : {}),
      ...(values.category ? { category: values.category } : {}),
      ...(tags.length > 0 ? { tags } : {})
    };

    return buildFrontmatterDocument(meta, values.body || 'Write your content here.');
  }

  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `admin-toast${isError ? ' error' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  function replaceSelection(textarea, replacement, selectionStart, selectionEnd) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const current = textarea.value;

    textarea.value = `${current.slice(0, start)}${replacement}${current.slice(end)}`;
    textarea.focus();

    const nextStart = selectionStart ?? start + replacement.length;
    const nextEnd = selectionEnd ?? nextStart;
    textarea.setSelectionRange(nextStart, nextEnd);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function wrapSelection(textarea, prefix, suffix, fallback = '텍스트') {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end) || fallback;
    const replacement = `${prefix}${selected}${suffix}`;

    replaceSelection(textarea, replacement, start + prefix.length, start + prefix.length + selected.length);
  }

  function applyList(textarea, ordered = false) {
    const value = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    const blockStart = value.lastIndexOf('\n', start - 1) + 1;
    const blockEndIndex = value.indexOf('\n', end);
    const blockEnd = blockEndIndex === -1 ? value.length : blockEndIndex;

    const block = value.slice(blockStart, blockEnd);
    const lines = block.split('\n');

    const replaced = lines
      .map((line, index) => {
        const clean = line.replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, '');
        return ordered ? `${index + 1}. ${clean}` : `- ${clean}`;
      })
      .join('\n');

    const next = `${value.slice(0, blockStart)}${replaced}${value.slice(blockEnd)}`;
    textarea.value = next;
    textarea.focus();
    textarea.setSelectionRange(blockStart, blockStart + replaced.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function applyBlockStyle(textarea, style) {
    const value = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    const blockStart = value.lastIndexOf('\n', start - 1) + 1;
    const blockEndIndex = value.indexOf('\n', end);
    const blockEnd = blockEndIndex === -1 ? value.length : blockEndIndex;

    const block = value.slice(blockStart, blockEnd);
    const lines = block.split('\n');

    const prefixMap = {
      normal: '',
      h2: '## ',
      h3: '### ',
      quote: '> '
    };

    const prefix = prefixMap[style] ?? '';

    const replaced = lines
      .map((line) => {
        const clean = line.replace(/^\s*(?:#{1,6}\s+|>\s+)/, '');
        return prefix ? `${prefix}${clean}` : clean;
      })
      .join('\n');

    const next = `${value.slice(0, blockStart)}${replaced}${value.slice(blockEnd)}`;
    textarea.value = next;
    textarea.focus();
    textarea.setSelectionRange(blockStart, blockStart + replaced.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function stripBasicMarkdown(text) {
    return String(text || '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/<u>(.*?)<\/u>/g, '$1')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1');
  }

  function applyMarkdownAction(textarea, action) {
    if (!textarea) return;

    if (action === 'bold') return wrapSelection(textarea, '**', '**');
    if (action === 'italic') return wrapSelection(textarea, '*', '*');
    if (action === 'underline') return wrapSelection(textarea, '<u>', '</u>');
    if (action === 'strike') return wrapSelection(textarea, '~~', '~~');
    if (action === 'ul') return applyList(textarea, false);
    if (action === 'ol') return applyList(textarea, true);

    if (action === 'link') {
      const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) || '링크 텍스트';
      const href = window.prompt('링크 주소를 입력하세요.', 'https://');
      if (!href) return;
      return replaceSelection(textarea, `[${selected}](${href.trim()})`);
    }

    if (action === 'image') {
      const src = window.prompt('이미지 주소를 입력하세요. (예: /uploads/image.png)', '/uploads/');
      if (!src) return;
      const alt = window.prompt('이미지 설명(alt)을 입력하세요.', 'image') || 'image';
      return replaceSelection(textarea, `\n![${alt.trim()}](${src.trim()})\n`);
    }

    if (action === 'clear') {
      const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
      if (!selected) return;
      const clean = stripBasicMarkdown(selected);
      return replaceSelection(textarea, clean);
    }
  }

  function renderEditorMarkup(name, placeholder) {
    return `
      <div class="admin-editor" data-markdown-editor>
        <div class="admin-editor__toolbar">
          <select class="admin-editor__select" data-md-block aria-label="Text style">
            <option value="normal">Normal</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="quote">Quote</option>
          </select>
          <button type="button" class="admin-editor__tool" data-md-action="bold" aria-label="Bold"><strong>B</strong></button>
          <button type="button" class="admin-editor__tool" data-md-action="italic" aria-label="Italic"><em>I</em></button>
          <button type="button" class="admin-editor__tool" data-md-action="underline" aria-label="Underline"><u>U</u></button>
          <button type="button" class="admin-editor__tool" data-md-action="strike" aria-label="Strike">S</button>
          <button type="button" class="admin-editor__tool" data-md-action="ul" aria-label="Bulleted list">-</button>
          <button type="button" class="admin-editor__tool" data-md-action="ol" aria-label="Numbered list">1.</button>
          <button type="button" class="admin-editor__tool" data-md-action="link" aria-label="Insert link">Link</button>
          <button type="button" class="admin-editor__tool" data-md-action="image" aria-label="Insert image">Img</button>
          <button type="button" class="admin-editor__tool" data-md-action="clear" aria-label="Clear formatting">Tx</button>
        </div>
        <textarea class="admin-textarea admin-editor__textarea" name="${name}" placeholder="${escapeHtml(placeholder)}"></textarea>
      </div>
    `;
  }

  function attachMarkdownEditors(scope) {
    scope.querySelectorAll('[data-markdown-editor]').forEach((editor) => {
      if (editor.dataset.bound) return;
      editor.dataset.bound = '1';

      const textarea = editor.querySelector('textarea');
      if (!textarea) return;

      editor.querySelectorAll('[data-md-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.getAttribute('data-md-action');
          if (action) applyMarkdownAction(textarea, action);
        });
      });

      const select = editor.querySelector('[data-md-block]');
      select?.addEventListener('change', () => {
        const value = select.value;
        applyBlockStyle(textarea, value);
        select.value = 'normal';
      });
    });
  }

  async function openRawEditor(file) {
    const body = createModal(`Edit ${file.path}`);
    if (!body) return;

    body.innerHTML = `
      <div class="admin-compose">
        <h3 class="admin-compose__title">원본 편집</h3>
        <label class="admin-field">
          <span>Commit message</span>
          <input type="text" class="admin-input" name="message" value="Edit ${escapeHtml(file.path)}" />
        </label>
        ${renderEditorMarkup('rawBody', '내용을 작성해주세요.')}
        <div class="admin-actions">
          <button type="button" class="admin-btn admin-btn--secondary" data-cancel>Cancel</button>
          <button type="button" class="admin-btn" data-save>Save</button>
        </div>
      </div>
    `;

    const textarea = body.querySelector('textarea[name="rawBody"]');
    if (textarea) textarea.value = file.content || '';

    attachMarkdownEditors(body);

    body.querySelector('[data-cancel]')?.addEventListener('click', closeModal);
    body.querySelector('[data-save]')?.addEventListener('click', async () => {
      const message = body.querySelector('input[name="message"]')?.value.trim() || `Edit ${file.path}`;
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
  }

  async function openEditor(path) {
    try {
      const file = await loadContentFile(path);
      const parsed = splitFrontmatter(file.content || '');

      if (!parsed) {
        await openRawEditor(file);
        return;
      }

      const meta = parseFrontmatterText(parsed.frontmatter);
      const tags = Array.isArray(meta.tags) ? meta.tags.join(', ') : '';

      const body = createModal(`글 편집: ${file.path}`);
      if (!body) return;

      body.innerHTML = `
        <div class="admin-compose">
          <h3 class="admin-compose__title">글 편집</h3>
          <label class="admin-field">
            <span>제목</span>
            <input class="admin-input" name="title" type="text" value="${escapeHtml(meta.title || '')}" />
          </label>
          <label class="admin-field">
            <span>설명</span>
            <input class="admin-input" name="description" type="text" value="${escapeHtml(meta.description || '')}" />
          </label>
          <label class="admin-field">
            <span>카테고리 (선택)</span>
            <input class="admin-input" name="category" type="text" value="${escapeHtml(meta.category || '')}" />
          </label>
          <label class="admin-field">
            <span>태그 (쉼표로 구분)</span>
            <input class="admin-input" name="tags" type="text" value="${escapeHtml(tags)}" />
          </label>
          <label class="admin-field">
            <span>내용</span>
          </label>
          ${renderEditorMarkup('body', '글을 작성해주세요.')}
          <label class="admin-field">
            <span>Commit message</span>
            <input class="admin-input" name="message" type="text" value="Edit ${escapeHtml(file.path)}" />
          </label>
          <div class="admin-actions">
            <button type="button" class="admin-btn admin-btn--secondary" data-cancel>Cancel</button>
            <button type="button" class="admin-btn" data-save>Save</button>
          </div>
        </div>
      `;

      const textarea = body.querySelector('textarea[name="body"]');
      if (textarea) textarea.value = parsed.body || '';

      attachMarkdownEditors(body);

      body.querySelector('[data-cancel]')?.addEventListener('click', closeModal);
      body.querySelector('[data-save]')?.addEventListener('click', async () => {
        const title = body.querySelector('input[name="title"]')?.value.trim() || meta.title || 'Untitled';
        const description =
          body.querySelector('input[name="description"]')?.value.trim() || meta.description || title;
        const category = body.querySelector('input[name="category"]')?.value.trim() || '';
        const tagInput = body.querySelector('input[name="tags"]')?.value || '';
        const message = body.querySelector('input[name="message"]')?.value.trim() || `Edit ${file.path}`;

        const nextMeta = { ...meta, title, description };
        const nextTags = parseTagsInput(tagInput);

        if (nextTags.length > 0) nextMeta.tags = nextTags;
        else delete nextMeta.tags;

        if (category) nextMeta.category = category;
        else delete nextMeta.category;

        const content = buildFrontmatterDocument(nextMeta, textarea?.value || '');

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
    const body = createModal(`새 글 작성 (${collection})`);
    if (!body) return;

    body.innerHTML = `
      <div class="admin-compose">
        <h3 class="admin-compose__title">새 글</h3>
        <label class="admin-field">
          <span>제목</span>
          <input class="admin-input" name="title" type="text" placeholder="제목" />
        </label>
        <label class="admin-field">
          <span>슬러그</span>
          <input class="admin-input" name="slug" type="text" placeholder="new-post" />
        </label>
        <label class="admin-field">
          <span>설명</span>
          <input class="admin-input" name="description" type="text" placeholder="설명" />
        </label>
        <label class="admin-field">
          <span>카테고리 (선택)</span>
          <input class="admin-input" name="category" type="text" />
        </label>
        <label class="admin-field">
          <span>태그 (쉼표로 구분)</span>
          <input class="admin-input" name="tags" type="text" />
        </label>
        <label class="admin-field">
          <span>내용</span>
        </label>
        ${renderEditorMarkup('body', '글을 작성해주세요.')}
        <div class="admin-actions">
          <button type="button" class="admin-btn admin-btn--secondary" data-cancel>Cancel</button>
          <button type="button" class="admin-btn" data-save>Create</button>
        </div>
      </div>
    `;

    const titleInput = body.querySelector('input[name="title"]');
    const slugInput = body.querySelector('input[name="slug"]');
    const textarea = body.querySelector('textarea[name="body"]');

    if (textarea) textarea.value = 'Write your content here.';
    attachMarkdownEditors(body);

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
        if (path) openEditor(path);
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
        <button type="button" data-action="edit-current-post">Edit current post</button>
        <button type="button" data-action="write-post">Write post</button>
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
            setAdminMode(false);
            window.location.reload();
          } catch (error) {
            showToast(error.message || 'Logout failed', true);
          }
          return;
        }

        if (action === 'edit-current-post') {
          const category =
            route.collection && WRITABLE_POST_COLLECTIONS.includes(route.collection)
              ? mapCollectionToPostCategory(route.collection)
              : '';
          const detail = { category, opened: false };
          window.dispatchEvent(new CustomEvent('ub:edit-current-post', { detail }));
          if (!detail.opened) {
            showToast('No editable post found on this page.', true);
          }
          return;
        }

        if (action === 'write-post') {
          const category =
            route.collection && WRITABLE_POST_COLLECTIONS.includes(route.collection)
              ? mapCollectionToPostCategory(route.collection)
              : '';
          openPostWriter(route.lang, category);
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
    button.addEventListener('click', openLoginDialog);

    host.appendChild(button);
  }

  async function init() {
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'ub-admin-auth-success') return;
      if (event.data.ok) {
        setAdminMode(true);
        const url = new URL(window.location.href);
        url.searchParams.set('admin', '8722');
        window.location.href = `${url.pathname}${url.search}`;
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

    if (shouldShowLoginButton()) {
      setAdminMode(true);
    }

    if (!isAdminModeRequested()) {
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
