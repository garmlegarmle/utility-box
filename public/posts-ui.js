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
      addTag: '태그 추가',
      tagPlaceholder: '태그 입력 후 Enter',
      suggestedTags: '추천 태그',
      categoryBlog: 'blog',
      categoryTool: 'tool',
      categoryGame: 'game',
      imageTools: '이미지 편집',
      imageWidth: '크기',
      imageAlign: '정렬',
      imageDelete: '이미지 삭제',
      imageSmall: '25%',
      imageMedium: '50%',
      imageLarge: '75%',
      imageFull: '100%',
      alignLeft: '좌',
      alignCenter: '중',
      alignRight: '우',
      confirmDelete: '이 글을 삭제하시겠습니까?',
      noSelection: '왼쪽에서 글을 선택하세요.',
      views: '조회',
      images: '첨부 이미지',
      requiredError: 'title/category/tag/body 는 필수입니다.'
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
      addTag: 'Add Tag',
      tagPlaceholder: 'Type tag and press Enter',
      suggestedTags: 'Suggested tags',
      categoryBlog: 'blog',
      categoryTool: 'tool',
      categoryGame: 'game',
      imageTools: 'Image tools',
      imageWidth: 'Size',
      imageAlign: 'Align',
      imageDelete: 'Delete image',
      imageSmall: '25%',
      imageMedium: '50%',
      imageLarge: '75%',
      imageFull: '100%',
      alignLeft: 'L',
      alignCenter: 'C',
      alignRight: 'R',
      confirmDelete: 'Delete this post?',
      noSelection: 'Select a post from the left list.',
      views: 'Views',
      images: 'Attachments',
      requiredError: 'title/category/tag/body are required.'
    }
  }[lang];

  const CATEGORY_OPTIONS = ['blog', 'tool', 'game'];

  const state = {
    posts: [],
    selectedId: null,
    selectedPost: null,
    isAdmin: false,
    username: null,
    tagPool: []
  };

  function normalizeCategory(value) {
    const category = String(value || '').toLowerCase().trim();
    return CATEGORY_OPTIONS.includes(category) ? category : 'blog';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => {
      if (char === '&') return '&amp;';
      if (char === '<') return '&lt;';
      if (char === '>') return '&gt;';
      if (char === '"') return '&quot;';
      return '&#39;';
    });
  }

  function normalizeTag(value) {
    return String(value || '').trim();
  }

  function getPostTags(post) {
    const tags = Array.isArray(post?.tags) ? post.tags : post?.tag ? [post.tag] : [];
    return tags.map(normalizeTag).filter(Boolean);
  }

  function collectTagPool(posts) {
    const map = new Map();
    posts.forEach((post) => {
      getPostTags(post).forEach((tag) => {
        const key = tag.toLowerCase();
        if (!map.has(key)) map.set(key, tag);
      });
    });
    return [...map.values()].sort((a, b) => a.localeCompare(b));
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

  function isBodyEmpty(html) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html || '';
    const text = (wrapper.textContent || '').replace(/\u00a0/g, ' ').trim();
    const hasMedia = wrapper.querySelector('img,video,iframe,table,blockquote,ul,ol');
    return !text && !hasMedia;
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
      const tags = getPostTags(post);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'notice-post-item';
      if (state.selectedId === post.id) {
        btn.classList.add('active');
      }
      btn.innerHTML = `
        <span class="notice-post-item__title">${escapeHtml(post.title)}</span>
        <span class="notice-post-item__meta">${escapeHtml(post.category)} · ${escapeHtml(tags.join(', '))}</span>
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
    const tags = getPostTags(post);

    detailEl.innerHTML = `
      <header class="notice-detail__head">
        <div>
          <p class="notice-detail__meta">${escapeHtml(post.category)} · ${escapeHtml(tags.join(', '))} · ${labels.views} ${post.views || 0}</p>
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
    state.tagPool = collectTagPool(state.posts);

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
      detailEl.innerHTML = `<p class="notice-board__state">${escapeHtml(error.message)}</p>`;
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

  function ensureEditorImageStyle(img) {
    img.classList.add('notice-editor-image');
    img.style.display = 'block';
    img.style.maxWidth = '100%';
    if (!img.style.width) img.style.width = '100%';
    if (!img.style.height) img.style.height = 'auto';
    if (!img.style.marginLeft && !img.style.marginRight) {
      img.style.marginLeft = 'auto';
      img.style.marginRight = 'auto';
    }
  }

  function normalizeEditorImages(editor) {
    editor.querySelectorAll('img').forEach((img) => ensureEditorImageStyle(img));
  }

  function selectEditorImage(editor, img, controls) {
    editor.querySelectorAll('img.notice-editor-image').forEach((node) => node.classList.remove('is-selected'));

    if (!img) {
      controls.selectedImage = null;
      controls.width.disabled = true;
      controls.width.value = '100';
      return;
    }

    ensureEditorImageStyle(img);
    img.classList.add('is-selected');
    controls.selectedImage = img;
    controls.width.disabled = false;

    const widthValue = Number.parseInt(img.style.width, 10);
    controls.width.value = Number.isFinite(widthValue) ? String(Math.max(10, Math.min(100, widthValue))) : '100';
  }

  function applyImageWidth(controls, percent) {
    if (!controls.selectedImage) return;
    const value = Math.max(10, Math.min(100, Number(percent) || 100));
    controls.selectedImage.style.width = `${value}%`;
    controls.selectedImage.style.maxWidth = '100%';
    controls.selectedImage.style.height = 'auto';
    controls.width.value = String(value);
  }

  function applyImageAlign(controls, align) {
    if (!controls.selectedImage) return;
    const img = controls.selectedImage;
    img.style.display = 'block';
    if (align === 'left') {
      img.style.marginLeft = '0';
      img.style.marginRight = 'auto';
    } else if (align === 'right') {
      img.style.marginLeft = 'auto';
      img.style.marginRight = '0';
    } else {
      img.style.marginLeft = 'auto';
      img.style.marginRight = 'auto';
    }
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
    normalizeEditorImages(editor);

    const controls = {
      selectedImage: null,
      width: container.querySelector('[data-role="image-width"]')
    };

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
          document.execCommand(
            'insertHTML',
            false,
            `<p><img class="notice-editor-image" src="${escapeHtml(url)}" alt="${escapeHtml(file.name)}" style="display:block;max-width:100%;width:100%;height:auto;margin-left:auto;margin-right:auto;" /></p><p><br></p>`
          );
          const inserted = editor.querySelector('img.notice-editor-image:last-of-type');
          selectEditorImage(editor, inserted, controls);
        } catch (error) {
          showToast(error.message || '이미지 업로드 실패', true);
          break;
        }
      }

      picker.value = '';
    });

    controls.width?.addEventListener('input', () => applyImageWidth(controls, controls.width.value));

    container.querySelectorAll('[data-image-preset]').forEach((button) => {
      button.addEventListener('click', () => applyImageWidth(controls, button.getAttribute('data-image-preset')));
    });

    container.querySelectorAll('[data-image-align]').forEach((button) => {
      button.addEventListener('click', () => applyImageAlign(controls, button.getAttribute('data-image-align')));
    });

    container.querySelector('[data-action="remove-image"]')?.addEventListener('click', () => {
      if (!controls.selectedImage) return;
      controls.selectedImage.remove();
      selectEditorImage(editor, null, controls);
    });

    editor.addEventListener('click', (event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement) {
        selectEditorImage(editor, target, controls);
      } else {
        selectEditorImage(editor, null, controls);
      }
    });

    editor.addEventListener('input', () => {
      normalizeEditorImages(editor);
    });

    selectEditorImage(editor, null, controls);
  }

  function setupTagBuilder(container, initialTags = []) {
    const chips = container.querySelector('[data-role="tag-chips"]');
    const input = container.querySelector('[data-role="tag-input"]');
    const addBtn = container.querySelector('[data-action="add-tag"]');
    const suggestions = container.querySelector('[data-role="tag-suggestions"]');
    const datalist = container.querySelector('[data-role="tag-datalist"]');

    const tags = [];

    function hasTag(tag) {
      const key = tag.toLowerCase();
      return tags.some((item) => item.toLowerCase() === key);
    }

    function addTag(value) {
      const tag = normalizeTag(value);
      if (!tag || hasTag(tag)) return;
      if (tags.length >= 20) return;
      tags.push(tag);
      render();
    }

    function removeTag(value) {
      const key = String(value || '').toLowerCase();
      const next = tags.filter((item) => item.toLowerCase() !== key);
      tags.length = 0;
      tags.push(...next);
      render();
    }

    function render() {
      chips.innerHTML = tags
        .map(
          (tag) =>
            `<button type="button" class="notice-tag-chip" data-tag-remove="${escapeHtml(tag)}"><span>${escapeHtml(
              tag
            )}</span><span>x</span></button>`
        )
        .join('');

      chips.querySelectorAll('[data-tag-remove]').forEach((button) => {
        button.addEventListener('click', () => removeTag(button.getAttribute('data-tag-remove')));
      });

      const candidate = state.tagPool.filter((tag) => !hasTag(tag));
      suggestions.innerHTML = candidate
        .slice(0, 12)
        .map((tag) => `<button type="button" class="notice-tag-suggestion" data-tag-pick="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`)
        .join('');

      suggestions.querySelectorAll('[data-tag-pick]').forEach((button) => {
        button.addEventListener('click', () => addTag(button.getAttribute('data-tag-pick')));
      });

      datalist.innerHTML = candidate.map((tag) => `<option value="${escapeHtml(tag)}"></option>`).join('');
    }

    function addFromInput() {
      addTag(input.value);
      input.value = '';
      input.focus();
    }

    addBtn?.addEventListener('click', addFromInput);

    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addFromInput();
      }
    });

    initialTags.forEach((tag) => addTag(tag));
    render();

    return {
      getTags() {
        return [...tags];
      }
    };
  }

  function gatherKeptImages(container) {
    return [...container.querySelectorAll('input[name="keepImageIds"]:checked')]
      .map((input) => input.value)
      .filter(Boolean);
  }

  async function submitPost(mode, postId, formRoot, tagBuilder, close) {
    const title = formRoot.querySelector('input[name="title"]')?.value.trim() || '';
    const category = formRoot.querySelector('select[name="category"]')?.value.trim() || '';
    const tags = tagBuilder.getTags();
    const editor = formRoot.querySelector('[data-role="rich-editor"]');
    const body = editor?.innerHTML.trim() || '';

    if (!title || !category || tags.length === 0 || isBodyEmpty(body)) {
      showToast(labels.requiredError, true);
      return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('Category', category);
    formData.append('tag', tags[0]);
    tags.forEach((tag) => formData.append('tags', tag));
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

  function openEditor(mode, post, options = {}) {
    const isEdit = mode === 'edit';
    const modal = createOverlay(isEdit ? labels.edit : labels.write);
    const images = Array.isArray(post?.images) ? post.images : [];
    const initialTags = isEdit ? getPostTags(post) : [];
    const selectedCategory = options.initialCategory
      ? normalizeCategory(options.initialCategory)
      : isEdit
        ? normalizeCategory(post?.category)
        : 'blog';

    modal.body.innerHTML = `
      <div class="admin-compose notice-compose">
        <label class="admin-field">
          <span>${labels.title}</span>
          <input class="admin-input" name="title" type="text" value="${isEdit ? escapeHtml(post.title) : ''}" />
        </label>

        <label class="admin-field">
          <span>${labels.category}</span>
          <select class="admin-input" name="category">
            <option value="blog" ${selectedCategory === 'blog' ? 'selected' : ''}>${labels.categoryBlog}</option>
            <option value="tool" ${selectedCategory === 'tool' ? 'selected' : ''}>${labels.categoryTool}</option>
            <option value="game" ${selectedCategory === 'game' ? 'selected' : ''}>${labels.categoryGame}</option>
          </select>
        </label>

        <div class="admin-field">
          <span>${labels.tag}</span>
          <div class="notice-tag-builder" data-role="tag-builder">
            <div class="notice-tag-builder__chips" data-role="tag-chips"></div>
            <div class="notice-tag-builder__input-row">
              <input class="admin-input" data-role="tag-input" type="text" placeholder="${labels.tagPlaceholder}" />
              <button type="button" class="admin-btn" data-action="add-tag">${labels.addTag}</button>
            </div>
            <p class="notice-tag-builder__label">${labels.suggestedTags}</p>
            <div class="notice-tag-builder__suggestions" data-role="tag-suggestions"></div>
            <datalist data-role="tag-datalist"></datalist>
          </div>
        </div>

        <label class="admin-field"><span>${labels.body}</span></label>
        <div class="admin-editor">
          <div class="admin-editor__toolbar">
            <div class="admin-editor__group">
              <select class="admin-editor__select" data-editor-block>
                <option value="p">Normal</option>
                <option value="h2">H2</option>
                <option value="h3">H3</option>
                <option value="blockquote">Quote</option>
              </select>
            </div>
            <div class="admin-editor__group">
              <button type="button" class="admin-editor__tool" data-editor-cmd="bold"><strong>B</strong></button>
              <button type="button" class="admin-editor__tool" data-editor-cmd="italic"><em>I</em></button>
              <button type="button" class="admin-editor__tool" data-editor-cmd="underline"><u>U</u></button>
              <button type="button" class="admin-editor__tool" data-editor-cmd="strikeThrough">S</button>
              <button type="button" class="admin-editor__tool" data-editor-cmd="insertUnorderedList">-</button>
              <button type="button" class="admin-editor__tool" data-editor-cmd="insertOrderedList">1.</button>
              <button type="button" class="admin-editor__tool" data-editor-cmd="link">Link</button>
              <button type="button" class="admin-editor__tool" data-editor-cmd="removeFormat">Tx</button>
            </div>
            <div class="admin-editor__group">
              <button type="button" class="admin-editor__tool" data-action="insert-inline-image">${labels.insertImage}</button>
              <input type="file" data-role="inline-image-picker" accept="image/*" hidden />
            </div>
            <div class="admin-editor__group admin-editor__group--image-tools">
              <span class="admin-editor__label">${labels.imageTools}</span>
              <button type="button" class="admin-editor__tool" data-image-preset="25">${labels.imageSmall}</button>
              <button type="button" class="admin-editor__tool" data-image-preset="50">${labels.imageMedium}</button>
              <button type="button" class="admin-editor__tool" data-image-preset="75">${labels.imageLarge}</button>
              <button type="button" class="admin-editor__tool" data-image-preset="100">${labels.imageFull}</button>
              <input class="admin-editor__range" data-role="image-width" type="range" min="10" max="100" value="100" disabled />
              <button type="button" class="admin-editor__tool" data-image-align="left">${labels.alignLeft}</button>
              <button type="button" class="admin-editor__tool" data-image-align="center">${labels.alignCenter}</button>
              <button type="button" class="admin-editor__tool" data-image-align="right">${labels.alignRight}</button>
              <button type="button" class="admin-editor__tool" data-action="remove-image">${labels.imageDelete}</button>
            </div>
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
    editor.innerHTML = isEdit ? post.body || '<p></p>' : '<p></p>';

    const tagBuilder = setupTagBuilder(modal.body.querySelector('[data-role="tag-builder"]'), initialTags);
    bindEditorTools(modal.body, editor);

    modal.body.querySelector('[data-action="cancel"]')?.addEventListener('click', modal.close);
    modal.body.querySelector('[data-action="save"]')?.addEventListener('click', () =>
      submitPost(mode, post?.id, modal.body, tagBuilder, modal.close)
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

    window.addEventListener('ub:open-notice-editor', (event) => {
      if (!state.isAdmin) return;
      const category = normalizeCategory(event?.detail?.category);
      openEditor('create', null, { initialCategory: category });
    });

    createBtn?.addEventListener('click', () => openEditor('create'));

    try {
      await loadPosts();
    } catch (error) {
      listStateEl.textContent = error.message || 'Failed to load';
    }

    const url = new URL(window.location.href);
    if (state.isAdmin && url.searchParams.get('write') === '1') {
      const category = normalizeCategory(url.searchParams.get('category'));
      openEditor('create', null, { initialCategory: category });
      url.searchParams.delete('write');
      url.searchParams.delete('category');
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    }
  }

  init();
})();
