(() => {
  const root = document.querySelector('[data-notice-board]');
  if (!root) return;

  const lang = root.getAttribute('data-lang') === 'ko' ? 'ko' : 'en';
  const listEl = root.querySelector('[data-role="post-list"]');
  const listStateEl = root.querySelector('[data-role="list-state"]');
  const detailEl = root.querySelector('[data-role="detail"]');
  const createBtn = root.querySelector('[data-action="create"]');

  const labels = {
    ko: {
      loading: '불러오는 중...',
      empty: '등록된 글이 없습니다.',
      write: '새 글 쓰기',
      edit: '수정',
      remove: '삭제',
      save: '저장',
      cancel: '취소',
      title: '제목',
      category: '카테고리',
      tag: '태그',
      body: '내용',
      attach: '첨부 이미지 (최대 6장, 파일당 10MB)',
      insertImage: '본문 이미지',
      confirmDelete: '이 글을 삭제하시겠습니까?',
      noSelection: '왼쪽에서 글을 선택하세요.',
      views: '조회',
      images: '첨부 이미지'
    },
    en: {
      loading: 'Loading...',
      empty: 'No posts yet.',
      write: 'Write Post',
      edit: 'Edit',
      remove: 'Delete',
      save: 'Save',
      cancel: 'Cancel',
      title: 'Title',
      category: 'Category',
      tag: 'Tag',
      body: 'Body',
      attach: 'Attached images (max 6, up to 10MB each)',
      insertImage: 'Insert Image',
      confirmDelete: 'Delete this post?',
      noSelection: 'Select a post from the left list.',
      views: 'Views',
      images: 'Attachments'
    }
  }[lang];

  const state = {
    posts: [],
    selectedId: null,
    selectedPost: null,
    isAdmin: false,
    username: null
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>\"']/g, (char) => {
      if (char === '&') return '&amp;';
      if (char === '<') return '&lt;';
      if (char === '>') return '&gt;';
      if (char === '\"') return '&quot;';
      return '&#39;';
    });
  }

  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `admin-toast${isError ? ' error' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  async function apiJson(url, init = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...init
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data.error || `Request failed: ${response.status}`);
    }

    return data;
  }

  async function fetchSession() {
    try {
      const session = await apiJson('/api/session');
      state.isAdmin = Boolean(session.authenticated && session.isAdmin);
      state.username = session.username || null;
    } catch {
      state.isAdmin = false;
      state.username = null;
    }

    createBtn.hidden = !state.isAdmin;
  }

  function renderList() {
    listEl.innerHTML = '';

    if (state.posts.length === 0) {
      listStateEl.textContent = labels.empty;
      return;
    }

    listStateEl.textContent = '';

    state.posts.forEach((post) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'notice-post-item';
      if (state.selectedId === post.id) {
        btn.classList.add('active');
      }
      btn.innerHTML = `
        <span class="notice-post-item__title">${escapeHtml(post.title)}</span>
        <span class="notice-post-item__meta">${escapeHtml(post.category)} · ${escapeHtml(post.tag)}</span>
      `;
      btn.addEventListener('click', () => openPost(post.id));

      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  function renderDetail() {
    if (!state.selectedPost) {
      detailEl.innerHTML = `<p class="notice-board__state">${labels.noSelection}</p>`;
      return;
    }

    const post = state.selectedPost;
    const images = Array.isArray(post.images) ? post.images : [];

    detailEl.innerHTML = `
      <header class="notice-detail__head">
        <div>
          <p class="notice-detail__meta">${escapeHtml(post.category)} · ${escapeHtml(post.tag)} · ${labels.views} ${post.views || 0}</p>
          <h2>${escapeHtml(post.title)}</h2>
          <p class="notice-detail__date">${new Date(post.updatedAt || post.createdAt).toLocaleString()}</p>
        </div>
        ${
          state.isAdmin
            ? `<div class="notice-detail__actions">
                <button type="button" class="admin-btn" data-action="edit">${labels.edit}</button>
                <button type="button" class="admin-btn admin-btn--secondary" data-action="delete">${labels.remove}</button>
              </div>`
            : ''
        }
      </header>
      <section class="notice-detail__body" data-role="detail-body"></section>
      ${
        images.length > 0
          ? `<section class="notice-detail__images">
              <h3>${labels.images}</h3>
              <div class="notice-image-grid">
                ${images
                  .map(
                    (img) =>
                      `<img src="/posts/${post.id}/images/${img.id}" alt="${escapeHtml(img.name || 'image')}" loading="lazy" decoding="async" />`
                  )
                  .join('')}
              </div>
            </section>`
          : ''
      }
    `;

    const bodyEl = detailEl.querySelector('[data-role="detail-body"]');
    if (bodyEl) {
      bodyEl.innerHTML = post.body || '';
    }

    if (state.isAdmin) {
      detailEl.querySelector('[data-action="edit"]')?.addEventListener('click', () => openEditor('edit', post));
      detailEl.querySelector('[data-action="delete"]')?.addEventListener('click', () => deletePost(post.id));
    }
  }

  async function loadPosts(selectedId) {
    listStateEl.textContent = labels.loading;

    const response = await apiJson('/posts');
    state.posts = Array.isArray(response.posts) ? response.posts : [];

    if (selectedId) {
      state.selectedId = selectedId;
    } else if (!state.selectedId && state.posts[0]) {
      state.selectedId = state.posts[0].id;
    }

    renderList();

    if (state.selectedId) {
      await openPost(state.selectedId, true);
    } else {
      state.selectedPost = null;
      renderDetail();
    }
  }

  async function openPost(postId, skipListRender = false) {
    state.selectedId = postId;
    if (!skipListRender) {
      renderList();
    }

    detailEl.innerHTML = `<p class="notice-board__state">${labels.loading}</p>`;

    try {
      const response = await apiJson(`/posts/${postId}`);
      state.selectedPost = response.post;
      renderDetail();
    } catch (error) {
      detailEl.innerHTML = `<p class="notice-board__state">${error.message}</p>`;
    }
  }

  function createOverlay(title) {
    const wrap = document.createElement('div');
    wrap.className = 'admin-modal';
    wrap.innerHTML = `
      <div class="admin-modal__backdrop" data-close="1"></div>
      <div class="admin-modal__panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="admin-modal__header">
          <h2>${escapeHtml(title)}</h2>
          <button type="button" class="admin-modal__close" aria-label="Close">x</button>
        </div>
        <div class="admin-modal__body"></div>
      </div>
    `;

    const close = () => {
      window.removeEventListener('keydown', onEsc);
      wrap.remove();
    };

    const onEsc = (event) => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('keydown', onEsc);
    wrap.querySelector('[data-close="1"]')?.addEventListener('click', close);
    wrap.querySelector('.admin-modal__close')?.addEventListener('click', close);

    document.body.appendChild(wrap);
    return {
      body: wrap.querySelector('.admin-modal__body'),
      close
    };
  }

  function editorCommand(editor, command) {
    editor.focus();

    if (command === 'link') {
      const href = window.prompt('링크 URL', 'https://');
      if (!href) return;
      document.execCommand('createLink', false, href.trim());
      return;
    }

    if (command === 'removeFormat') {
      document.execCommand('removeFormat', false);
      return;
    }

    document.execCommand(command, false);
  }

  async function uploadInlineImage(file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiJson('/posts/assets', {
      method: 'POST',
      body: formData
    });

    return response.url;
  }

  function bindEditorTools(container, editor) {
    container.querySelectorAll('[data-editor-cmd]').forEach((button) => {
      button.addEventListener('click', () => {
        const cmd = button.getAttribute('data-editor-cmd');
        if (!cmd) return;
        editorCommand(editor, cmd);
      });
    });

    container.querySelector('[data-editor-block]')?.addEventListener('change', (event) => {
      const value = event.target.value;
      editor.focus();
      if (value === 'p') document.execCommand('formatBlock', false, 'p');
      if (value === 'h2') document.execCommand('formatBlock', false, 'h2');
      if (value === 'h3') document.execCommand('formatBlock', false, 'h3');
      if (value === 'blockquote') document.execCommand('formatBlock', false, 'blockquote');
      event.target.value = 'p';
    });

    const insertBtn = container.querySelector('[data-action="insert-inline-image"]');
    const picker = container.querySelector('input[data-role="inline-image-picker"]');

    insertBtn?.addEventListener('click', () => picker?.click());

    picker?.addEventListener('change', async () => {
      const files = [...(picker.files || [])];
      if (files.length === 0) return;

      for (const file of files) {
        try {
          const url = await uploadInlineImage(file);
          editor.focus();
          document.execCommand('insertHTML', false, `<img src="${url}" alt="${file.name}" />`);
        } catch (error) {
          showToast(error.message || '이미지 업로드 실패', true);
          break;
        }
      }

      picker.value = '';
    });
  }

  function gatherKeptImages(container) {
    return [...container.querySelectorAll('input[name="keepImageIds"]:checked')]
      .map((input) => input.value)
      .filter(Boolean);
  }

  async function submitPost(mode, postId, formRoot, close) {
    const title = formRoot.querySelector('input[name="title"]')?.value.trim() || '';
    const category = formRoot.querySelector('input[name="category"]')?.value.trim() || '';
    const tag = formRoot.querySelector('input[name="tag"]')?.value.trim() || '';
    const editor = formRoot.querySelector('[data-role="rich-editor"]');
    const body = editor?.innerHTML.trim() || '';

    if (!title || !category || !tag || !body) {
      showToast('title/category/tag/body are required', true);
      return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('Category', category);
    formData.append('tag', tag);
    formData.append('body', body);

    if (mode === 'edit') {
      gatherKeptImages(formRoot).forEach((id) => formData.append('keepImageIds', id));
    }

    const files = formRoot.querySelector('input[name="images"]')?.files || [];
    [...files].forEach((file) => formData.append('images', file));

    const url = mode === 'create' ? '/posts' : `/posts/${postId}`;
    const method = mode === 'create' ? 'POST' : 'PUT';

    try {
      const response = await apiJson(url, {
        method,
        body: formData
      });

      close();
      await loadPosts(response.post?.id || state.selectedId);
      if (response.post?.id) {
        state.selectedId = response.post.id;
        await openPost(response.post.id);
      }
      showToast(mode === 'create' ? 'created' : 'updated');
    } catch (error) {
      showToast(error.message || 'save failed', true);
    }
  }

  function openEditor(mode, post) {
    const isEdit = mode === 'edit';
    const modal = createOverlay(isEdit ? labels.edit : labels.write);
    const images = Array.isArray(post?.images) ? post.images : [];

    modal.body.innerHTML = `
      <div class="admin-compose notice-compose">
        <label class="admin-field">
          <span>${labels.title}</span>
          <input class="admin-input" name="title" type="text" value="${isEdit ? escapeHtml(post.title) : ''}" />
        </label>
        <label class="admin-field">
          <span>${labels.category}</span>
          <input class="admin-input" name="category" type="text" value="${isEdit ? escapeHtml(post.category) : ''}" />
        </label>
        <label class="admin-field">
          <span>${labels.tag}</span>
          <input class="admin-input" name="tag" type="text" value="${isEdit ? escapeHtml(post.tag) : ''}" />
        </label>

        <label class="admin-field"><span>${labels.body}</span></label>
        <div class="admin-editor">
          <div class="admin-editor__toolbar">
            <select class="admin-editor__select" data-editor-block>
              <option value="p">Normal</option>
              <option value="h2">H2</option>
              <option value="h3">H3</option>
              <option value="blockquote">Quote</option>
            </select>
            <button type="button" class="admin-editor__tool" data-editor-cmd="bold"><strong>B</strong></button>
            <button type="button" class="admin-editor__tool" data-editor-cmd="italic"><em>I</em></button>
            <button type="button" class="admin-editor__tool" data-editor-cmd="underline"><u>U</u></button>
            <button type="button" class="admin-editor__tool" data-editor-cmd="strikeThrough">S</button>
            <button type="button" class="admin-editor__tool" data-editor-cmd="insertUnorderedList">-</button>
            <button type="button" class="admin-editor__tool" data-editor-cmd="insertOrderedList">1.</button>
            <button type="button" class="admin-editor__tool" data-editor-cmd="link">Link</button>
            <button type="button" class="admin-editor__tool" data-action="insert-inline-image">${labels.insertImage}</button>
            <button type="button" class="admin-editor__tool" data-editor-cmd="removeFormat">Tx</button>
            <input type="file" data-role="inline-image-picker" accept="image/*" hidden />
          </div>
          <div class="notice-rich-editor" contenteditable="true" data-role="rich-editor"></div>
        </div>

        ${
          isEdit && images.length > 0
            ? `<fieldset class="notice-compose__keep-images">
                <legend>${labels.images}</legend>
                ${images
                  .map(
                    (img) =>
                      `<label>
                        <input type="checkbox" name="keepImageIds" value="${escapeHtml(img.id)}" checked />
                        <span>${escapeHtml(img.name || img.id)}</span>
                      </label>`
                  )
                  .join('')}
              </fieldset>`
            : ''
        }

        <label class="admin-field">
          <span>${labels.attach}</span>
          <input class="admin-input" name="images" type="file" accept="image/*" multiple />
        </label>

        <div class="admin-actions">
          <button type="button" class="admin-btn admin-btn--secondary" data-action="cancel">${labels.cancel}</button>
          <button type="button" class="admin-btn" data-action="save">${labels.save}</button>
        </div>
      </div>
    `;

    const editor = modal.body.querySelector('[data-role="rich-editor"]');
    editor.innerHTML = isEdit ? post.body || '' : '<p></p>';

    bindEditorTools(modal.body, editor);

    modal.body.querySelector('[data-action="cancel"]')?.addEventListener('click', modal.close);
    modal.body.querySelector('[data-action="save"]')?.addEventListener('click', () =>
      submitPost(mode, post?.id, modal.body, modal.close)
    );
  }

  async function deletePost(postId) {
    if (!window.confirm(labels.confirmDelete)) return;

    try {
      await apiJson(`/posts/${postId}`, { method: 'DELETE' });
      state.selectedPost = null;
      state.selectedId = null;
      await loadPosts();
      showToast('deleted');
    } catch (error) {
      showToast(error.message || 'delete failed', true);
    }
  }

  async function init() {
    await fetchSession();

    createBtn?.addEventListener('click', () => openEditor('create'));

    try {
      await loadPosts();
    } catch (error) {
      listStateEl.textContent = error.message || 'Failed to load';
    }
  }

  init();
})();
