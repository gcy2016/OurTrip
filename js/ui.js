// 通用界面工具：创建元素、对话框、操作菜单、提示条。所有用户文本都用 textContent 写入。

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'text') el.textContent = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// ---------- 提示条 ----------

let toastBox;
export function toast(message, kind = 'info', ms = 3200) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastBox);
  }
  const t = h('div', { class: `toast toast-${kind}` }, message);
  toastBox.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// ---------- 对话框 ----------

const openDialogs = [];

/**
 * 打开对话框。build(close) 返回内容元素；close(value) 关闭并 resolve。
 * 点击遮罩或按 Esc 视为取消（resolve undefined）。
 */
export function dialog(build, { title = '', wide = false, dismissable = true, onClose = null } = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      if (onClose) onClose(value);
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      openDialogs.splice(openDialogs.indexOf(overlay), 1);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable && openDialogs[openDialogs.length - 1] === overlay) {
        e.stopPropagation();
        close(undefined);
      }
    };
    const panel = h(
      'div',
      { class: `dialog${wide ? ' dialog-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '对话框' },
      title ? h('h2', { class: 'dialog-title' }, title) : null
    );
    const body = build(close);
    if (body) panel.appendChild(body);
    const overlay = h('div', { class: 'overlay' }, panel);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay && dismissable) close(undefined);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    openDialogs.push(overlay);
    const focusable = panel.querySelector('[autofocus], input, textarea, button');
    if (focusable) setTimeout(() => focusable.focus(), 0);
  });
}

export function buttons(...items) {
  return h('div', { class: 'dialog-actions' }, ...items);
}

export function alertDialog(message, { title = '提示', okLabel = '知道了' } = {}) {
  return dialog(
    (close) =>
      h('div', null, h('p', { class: 'dialog-text' }, message), buttons(h('button', { class: 'btn btn-primary', onclick: () => close(true) }, okLabel))),
    { title }
  );
}

export function confirmDialog(message, { title = '请确认', okLabel = '确定', danger = false } = {}) {
  return dialog(
    (close) =>
      h(
        'div',
        null,
        h('p', { class: 'dialog-text' }, message),
        buttons(
          h('button', { class: 'btn', onclick: () => close(false) }, '取消'),
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => close(true) }, okLabel)
        )
      ),
    { title }
  ).then((v) => v === true);
}

export function promptDialog(title, { value = '', placeholder = '', multiline = false, okLabel = '保存', hint = '' } = {}) {
  return dialog(
    (close) => {
      const input = multiline
        ? h('textarea', { class: 'input', rows: 6, placeholder, autofocus: true })
        : h('input', { class: 'input', type: 'text', placeholder, autofocus: true });
      input.value = value;
      const submit = () => close(input.value);
      if (!multiline) input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      return h(
        'div',
        null,
        hint ? h('p', { class: 'dialog-hint' }, hint) : null,
        input,
        buttons(h('button', { class: 'btn', onclick: () => close(undefined) }, '取消'), h('button', { class: 'btn btn-primary', onclick: submit }, okLabel))
      );
    },
    { title }
  );
}

/** 操作菜单：options = [{label, value, danger, disabled, hint}] */
export function actionSheet(title, options) {
  return dialog(
    (close) =>
      h(
        'div',
        { class: 'sheet' },
        options.map((o) =>
          h(
            'button',
            {
              class: `sheet-item${o.danger ? ' danger' : ''}`,
              disabled: o.disabled,
              onclick: () => close(o.value),
            },
            h('span', null, o.label),
            o.hint ? h('small', null, o.hint) : null
          )
        ),
        h('button', { class: 'sheet-item sheet-cancel', onclick: () => close(undefined) }, '取消')
      ),
    { title }
  );
}

export function busy(button, promise) {
  const label = button.textContent;
  button.disabled = true;
  button.classList.add('is-busy');
  return Promise.resolve(promise).finally(() => {
    button.disabled = false;
    button.classList.remove('is-busy');
    button.textContent = label;
  });
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
