import './style.css';
import { normalizeHexColor as normalizeHex, resolveBodyColor } from './settings.js';

const ICONS = {
  camera: '<path d="M8 5l1-2h6l1 2h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><circle cx="12" cy="12" r="4"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  reset: '<path d="M4 10a8 8 0 1 1 8 10M4 10V4m0 6h6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="m9 6 6 6-6 6"/>',
};
const TABS = [
  { id: 'shapes', label: '形状', field: 'shape' },
  { id: 'eyes', label: '眼睛', field: 'eyes' },
  { id: 'eyewear', label: '眼镜', field: 'eyewear' },
  { id: 'accessories', label: '配饰', field: 'accessories' },
  { id: 'fur', label: '毛绒' },
];
const icon = (name) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const colorValue = (value) => typeof value === 'number' ? `#${value.toString(16).padStart(6, '0')}` : value || '#fa70ab';
const copyAppearance = (value) => ({ ...value, accessories: [...(value.accessories || [])], accessoryColors: { ...(value.accessoryColors || {}) } });
const EAR_SHAPES = new Set(['rounded_head_two_ears', 'circle_two_ears']);
const thumbnailURL = (path) => `${import.meta.env?.BASE_URL ?? '/'}${path.replace(/^\/+/, '')}`;

export function setupUI({
  catalog, parameterDefs, initialAppearance, initialParameters = {}, initialQuality = 'auto',
  onAppearance, onParameter, onQuality, onPause, onReset, onCapture, onSave, onExport,
}) {
  const app = document.getElementById('app');
  const viewport = document.getElementById('viewport');
  let appearance = copyAppearance(initialAppearance);
  let parameters = Object.fromEntries(parameterDefs.map((definition) => [definition.id, initialParameters[definition.id] ?? definition.default]));
  let paused = false;
  let toastTimer;
  let activeTab = 'shapes';

  const editor = document.createElement('aside');
  editor.className = 'editor-panel';
  editor.setAttribute('aria-label', '编辑 Dots 外形');
  const optionButton = (item, category) => `<button class="option-card" type="button" data-category="${category}" data-option="${escapeHTML(item.id)}" aria-label="${escapeHTML(item.label || item.title)}" aria-pressed="false" title="${escapeHTML(item.label || item.title)} · ${escapeHTML(item.id)}"><span class="option-art">${item.thumbnail ? `<img src="${escapeHTML(thumbnailURL(item.thumbnail))}" alt="" draggable="false" width="240" height="240" />` : '<span class="empty-accessory" aria-hidden="true"></span>'}</span><span class="option-caption">${escapeHTML(item.label || item.title)}</span><span class="selection-tick">${icon('check')}</span></button>`;
  editor.innerHTML = `
    <header class="editor-header"><a class="brand" href="./" aria-label="Dots 毛绒实验室">dots<span>.</span></a><span class="studio-label">毛绒实验室</span></header>
    <nav class="editor-tabs" role="tablist" aria-label="外形类别">${TABS.map((tab, index) => `<button type="button" class="editor-tab" role="tab" id="tab-${tab.id}" aria-controls="panel-${tab.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-tab="${tab.id}">${tab.label}</button>`).join('')}</nav>
    <div class="editor-content">
      ${TABS.filter((tab) => tab.id !== 'fur').map((tab, index) => `<section class="choice-panel" role="tabpanel" id="panel-${tab.id}" aria-labelledby="tab-${tab.id}" ${index ? 'hidden' : ''}>
        <div class="panel-caption"><p>${{ shapes: '选一个喜欢的轮廓。', eyes: '给它一点小表情。', eyewear: '今天戴哪一副？', accessories: '再添一点个性。' }[tab.id]}</p><span>${catalog[tab.id].length}${tab.id === 'accessories' ? ' 款配饰' : ' 种选择'}</span></div>
        <div class="option-grid" data-grid="${tab.id}">${tab.id === 'accessories' && !catalog.accessories.some((item) => item.id === 'none') ? optionButton({ id: 'none', label: '无配饰', title: 'None', thumbnail: catalog.eyewear.find((item) => item.id === 'none')?.thumbnail }, 'accessories') : ''}${catalog[tab.id].map((item) => optionButton(item, tab.id)).join('')}</div>
        ${tab.id === 'accessories' ? '<p class="accessory-note">一次佩戴一款配饰，再次点击即可摘下。</p>' : ''}
      </section>`).join('')}
      <section class="fur-panel" role="tabpanel" id="panel-fur" aria-labelledby="tab-fur" hidden>
        <div class="panel-caption"><p>把柔软，调成你喜欢的样子。</p><span>实时预览</span></div>
        <div class="parameter-list">${parameterDefs.map((definition) => `<div class="parameter-row">
          <div class="parameter-heading"><label for="param-${definition.id}"><span class="parameter-english">${escapeHTML(definition.id)}</span><span class="parameter-chinese">${escapeHTML(definition.label)}</span></label><div class="parameter-number-wrap"><input id="number-${definition.id}" data-number="${definition.id}" type="number" aria-label="${escapeHTML(definition.label)}精确数值" min="${definition.min}" max="${definition.max}" step="${definition.step}" value="${parameters[definition.id]}" />${definition.id === 'density' ? '<span class="parameter-unit" aria-hidden="true">k</span>' : ''}</div></div>
          <input id="param-${definition.id}" data-parameter="${definition.id}" type="range" min="${definition.min}" max="${definition.max}" step="${definition.step}" value="${parameters[definition.id]}" aria-describedby="description-${definition.id}" />
          <p class="parameter-description" id="description-${definition.id}">${escapeHTML(definition.description)}</p>
        </div>`).join('')}</div>
        <div class="quality-row"><label for="quality">渲染质量</label><select id="quality"><option value="auto">自动适应</option><option value="high">高 · 细腻毛发</option><option value="medium">中 · 平衡表现</option><option value="low">低 · 轻盈流畅</option></select></div>
      </section>
      <details class="geometry-details" hidden><summary>查看原始外形参数${icon('arrow')}</summary><pre class="geometry-values"></pre></details>
    </div>
    <footer class="palette-footer">
      <section class="body-color-controls" aria-label="形状颜色">
        <div class="palette body-palette" role="group" aria-label="角色颜色">${catalog.colors.map((color) => `<button class="color-option" type="button" data-color="${escapeHTML(color.id)}" aria-label="${escapeHTML(color.label || color.title)}" aria-pressed="false" title="${escapeHTML(color.label || color.title)} ${escapeHTML(colorValue(color.hex))}" style="--swatch:${escapeHTML(colorValue(color.hex))}"><span></span></button>`).join('')}</div>
        <div class="custom-color-row"><label class="custom-color-picker"><input type="color" id="body-color-picker" aria-label="自定义形状颜色" value="#fa70ab" /><span>自定义</span></label><label class="custom-color-hex"><span>HEX</span><input type="text" id="body-color-hex" aria-label="形状颜色 HEX" placeholder="#RRGGBB" maxlength="7" spellcheck="false" autocomplete="off" autocapitalize="off" /></label></div>
      </section>
      <section class="accessory-color-controls" aria-labelledby="accessory-color-label" hidden>
        <div class="accessory-color-heading"><p id="accessory-color-label">配饰颜色 · 先选择配饰</p><button class="accessory-original" type="button" aria-label="恢复配饰原色" aria-pressed="true">恢复原色</button></div>
        <div class="palette accessory-palette" role="group" aria-label="配饰预设颜色">${catalog.colors.map((color) => `<button class="color-option" type="button" data-accessory-color="${escapeHTML(colorValue(color.hex))}" aria-label="配饰${escapeHTML(color.label || color.title)}" aria-pressed="false" title="配饰${escapeHTML(color.label || color.title)} ${escapeHTML(colorValue(color.hex))}" style="--swatch:${escapeHTML(colorValue(color.hex))}"><span></span></button>`).join('')}</div>
        <div class="custom-color-row"><label class="custom-color-picker"><input type="color" id="accessory-color-picker" aria-label="自定义配饰颜色" value="#242424" /><span>自定义</span></label><label class="custom-color-hex"><span>HEX</span><input type="text" id="accessory-color-hex" aria-label="配饰颜色 HEX" placeholder="原色" maxlength="7" spellcheck="false" autocomplete="off" autocapitalize="off" /></label></div>
      </section>
    </footer>
  `;

  const preview = document.createElement('section');
  preview.className = 'preview-panel';
  preview.setAttribute('aria-label', '角色实时预览');
  preview.innerHTML = `
    <header class="preview-header"><p class="preview-eyebrow">MEET YOUR DOT</p><label class="sr-only" for="character-name">角色名字</label><input id="character-name" type="text" maxlength="24" autocomplete="off" spellcheck="false" value="${escapeHTML(appearance.name || '番薯')}" /><p class="name-hint">点击名字，为它起个名</p></header>
    <footer class="preview-footer">
      <p class="interaction-hint">拖动转个身 <span>·</span> 滚轮靠近一点</p>
      <button class="save-button" type="button"><span class="save-label">保存</span><span class="saved-check" hidden>${icon('check')}</span></button>
      <div class="preview-tools"><div class="export-actions"><button class="text-button capture-button" type="button" title="导出 PNG 图片">${icon('camera')}<span>PNG</span></button><button class="text-button export-button" type="button" title="导出外形与毛绒参数 JSON">${icon('download')}<span>JSON</span></button></div><div class="playback-actions"><button class="icon-button motion-toggle" type="button" aria-label="暂停动画" title="暂停动画" aria-pressed="false">${icon('pause')}</button><button class="icon-button motion-reset" type="button" aria-label="恢复默认外形与参数" title="恢复默认外形与参数">${icon('reset')}</button></div></div>
      <div class="render-status"><span class="status-dot"></span><span id="render-fps">— FPS</span><span class="status-separator">/</span><span id="render-strands">绒毛准备中</span></div>
    </footer>
  `;
  preview.insertBefore(viewport, preview.querySelector('.preview-footer'));
  const loading = document.createElement('div');
  loading.className = 'loading-overlay';
  loading.setAttribute('aria-live', 'polite');
  loading.innerHTML = '<span class="loading-dot"></span><p>让柔软发生<span>正在准备小家伙…</span></p>';
  viewport.append(loading);
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  app.append(editor, preview, toast);
  app.setAttribute('aria-busy', 'true');

  const qualityInput = editor.querySelector('#quality');
  const nameInput = preview.querySelector('#character-name');
  const motionToggle = preview.querySelector('.motion-toggle');
  const saveButton = preview.querySelector('.save-button');
  const tabs = [...editor.querySelectorAll('[data-tab]')];
  const bodyColorControls = editor.querySelector('.body-color-controls');
  const bodyColorPicker = editor.querySelector('#body-color-picker');
  const bodyColorHex = editor.querySelector('#body-color-hex');
  const accessoryColorControls = editor.querySelector('.accessory-color-controls');
  const accessoryColorPicker = editor.querySelector('#accessory-color-picker');
  const accessoryColorHex = editor.querySelector('#accessory-color-hex');
  const accessoryOriginal = editor.querySelector('.accessory-original');

  function selectedAccessory() {
    return catalog.accessories.find((entry) => entry.id === appearance.accessories[0] && entry.id !== 'none');
  }
  function updateAccessoryColorControls() {
    const accessory = selectedAccessory();
    const color = accessory ? normalizeHex(appearance.accessoryColors[accessory.id]) : null;
    editor.querySelector('#accessory-color-label').textContent = accessory ? `配饰颜色 · ${accessory.label || accessory.title}` : '配饰颜色 · 先选择配饰';
    accessoryColorControls.classList.toggle('is-disabled', !accessory);
    for (const control of accessoryColorControls.querySelectorAll('button, input')) control.disabled = !accessory;
    for (const button of editor.querySelectorAll('[data-accessory-color]')) button.setAttribute('aria-pressed', String(Boolean(color) && normalizeHex(button.dataset.accessoryColor) === color));
    accessoryOriginal.setAttribute('aria-pressed', String(!color));
    accessoryColorPicker.value = color || '#242424';
    if (document.activeElement !== accessoryColorHex) accessoryColorHex.value = color || '';
    accessoryColorHex.placeholder = accessory ? '原色' : '先选择配饰';
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }
  function setSaved(saved) {
    saveButton.classList.toggle('is-saved', Boolean(saved));
    saveButton.querySelector('.save-label').textContent = saved ? '已保存' : '保存';
    saveButton.querySelector('.saved-check').hidden = !saved;
  }
  function setAppearance(value) {
    appearance = copyAppearance(value);
    const usesInsetEyes = appearance.shape === 'rounded_head_two_ears';
    if (usesInsetEyes) appearance.eyes = 'round_inset';
    else if (appearance.eyes === 'round_inset') appearance.eyes = 'oval';
    if (EAR_SHAPES.has(appearance.shape)) appearance.accessories = appearance.accessories.filter((id) => catalog.accessories.find((item) => item.id === id)?.slot !== 'headwear');
    appearance.accessories = appearance.accessories.slice(-1);
    for (const button of editor.querySelectorAll('[data-option]')) {
      const category = button.dataset.category;
      const id = button.dataset.option;
      button.hidden = category === 'eyes' ? (usesInsetEyes ? id !== 'round_inset' : id === 'round_inset')
        : category === 'accessories' && EAR_SHAPES.has(appearance.shape) && catalog.accessories.find((item) => item.id === id)?.slot === 'headwear';
      const selected = category === 'accessories'
        ? id === 'none' ? appearance.accessories.length === 0 : appearance.accessories.includes(id)
        : appearance[TABS.find((tab) => tab.id === category).field] === id;
      button.setAttribute('aria-pressed', String(selected));
    }
    for (const category of ['eyes', 'accessories']) {
      const count = [...editor.querySelectorAll(`[data-category="${category}"]`)].filter((button) => !button.hidden && button.dataset.option !== 'none').length;
      editor.querySelector(`#panel-${category} .panel-caption > span`).textContent = `${count}${category === 'accessories' ? ' 款配饰' : ' 种选择'}`;
    }
    editor.querySelector('.accessory-note').textContent = EAR_SHAPES.has(appearance.shape)
      ? '这个双耳轮廓可选耳机或领结，一次佩戴一款。再次点击即可摘下。'
      : '一次佩戴一款配饰，再次点击即可摘下。';
    const color = resolveBodyColor(appearance.color);
    for (const button of editor.querySelectorAll('[data-color]')) button.setAttribute('aria-pressed', String(resolveBodyColor(button.dataset.color) === color));
    app.style.setProperty('--character-color', color);
    bodyColorPicker.value = color;
    if (document.activeElement !== bodyColorHex) bodyColorHex.value = color;
    updateAccessoryColorControls();
    if (document.activeElement !== nameInput) nameInput.value = appearance.name || '番薯';
  }
  function publishAppearance() {
    setSaved(false);
    setAppearance(appearance);
    onAppearance?.(copyAppearance(appearance));
  }
  function setTab(id) {
    activeTab = id;
    for (const tab of tabs) {
      const selected = tab.dataset.tab === activeTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      editor.querySelector(`#panel-${tab.dataset.tab}`).hidden = !selected;
    }
    editor.querySelector('.editor-content').scrollTop = 0;
    bodyColorControls.hidden = id === 'accessories';
    accessoryColorControls.hidden = id !== 'accessories';
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => setTab(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      let target;
      if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[target].focus();
      setTab(tabs[target].dataset.tab);
    });
  }
  editor.querySelectorAll('[data-option]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.option;
    if (button.dataset.category === 'accessories') {
      appearance.accessories = id === 'none' || appearance.accessories.includes(id) ? [] : [id];
    } else appearance[TABS.find((tab) => tab.id === button.dataset.category).field] = id;
    publishAppearance();
  }));
  editor.querySelectorAll('[data-color]').forEach((button) => button.addEventListener('click', () => {
    appearance.color = button.dataset.color;
    publishAppearance();
  }));
  function commitBodyColor(value) {
    const color = normalizeHex(value);
    if (!color || resolveBodyColor(appearance.color) === color) return;
    appearance.color = catalog.colors.find((entry) => normalizeHex(colorValue(entry.hex)) === color)?.id || color;
    publishAppearance();
  }
  bodyColorPicker.addEventListener('input', () => commitBodyColor(bodyColorPicker.value));
  bodyColorPicker.addEventListener('change', () => commitBodyColor(bodyColorPicker.value));
  bodyColorHex.addEventListener('input', (event) => { if (!event.isComposing) commitBodyColor(bodyColorHex.value); });
  bodyColorHex.addEventListener('compositionend', () => commitBodyColor(bodyColorHex.value));
  bodyColorHex.addEventListener('blur', () => {
    const value = bodyColorHex.value.trim();
    const color = normalizeHex(value);
    if (color) commitBodyColor(color);
    else if (value) showToast('请使用 #RGB 或 #RRGGBB，已恢复当前形状颜色。');
    bodyColorHex.value = resolveBodyColor(appearance.color);
  });
  bodyColorHex.addEventListener('keydown', (event) => { if (event.key === 'Enter') bodyColorHex.blur(); });
  function commitAccessoryColor(value) {
    const accessory = selectedAccessory();
    const color = normalizeHex(value);
    if (!accessory || !color || appearance.accessoryColors[accessory.id] === color) return;
    appearance.accessoryColors[accessory.id] = color;
    publishAppearance();
  }
  editor.querySelectorAll('[data-accessory-color]').forEach((button) => button.addEventListener('click', () => commitAccessoryColor(button.dataset.accessoryColor)));
  accessoryColorPicker.addEventListener('input', () => commitAccessoryColor(accessoryColorPicker.value));
  accessoryColorPicker.addEventListener('change', () => commitAccessoryColor(accessoryColorPicker.value));
  accessoryColorHex.addEventListener('input', (event) => { if (!event.isComposing) commitAccessoryColor(accessoryColorHex.value); });
  accessoryColorHex.addEventListener('compositionend', () => commitAccessoryColor(accessoryColorHex.value));
  accessoryColorHex.addEventListener('blur', () => {
    const value = accessoryColorHex.value.trim();
    const color = normalizeHex(value);
    if (color) commitAccessoryColor(color);
    else if (value) showToast('请使用 #RGB 或 #RRGGBB，已恢复当前配饰颜色。');
    const accessory = selectedAccessory();
    accessoryColorHex.value = accessory ? normalizeHex(appearance.accessoryColors[accessory.id]) || '' : '';
  });
  accessoryColorHex.addEventListener('keydown', (event) => { if (event.key === 'Enter') accessoryColorHex.blur(); });
  accessoryOriginal.addEventListener('click', () => {
    const accessory = selectedAccessory();
    if (!accessory || !Object.hasOwn(appearance.accessoryColors, accessory.id)) return;
    delete appearance.accessoryColors[accessory.id];
    publishAppearance();
  });
  editor.querySelectorAll('.option-grid, .palette').forEach((grid) => grid.addEventListener('keydown', (event) => {
    const buttons = [...grid.querySelectorAll('button')].filter((button) => !button.hidden && !button.disabled);
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const columns = grid.classList.contains('palette') ? buttons.length : 4;
    const offset = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
    if (!offset) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, index + offset))].focus();
  }));
  const commitName = (format = false) => {
    const name = nameInput.value.trim() || '番薯';
    if (format) nameInput.value = name;
    if (name === appearance.name) return;
    appearance.name = name;
    publishAppearance();
  };
  nameInput.addEventListener('input', (event) => { if (!event.isComposing) commitName(); });
  nameInput.addEventListener('compositionend', () => commitName());
  nameInput.addEventListener('change', () => commitName(true));
  nameInput.addEventListener('blur', () => commitName(true));
  nameInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') nameInput.blur(); });

  function updateParameterControls(definition, preserveNumber = false) {
    const value = Number(parameters[definition.id]);
    const slider = editor.querySelector(`#param-${definition.id}`);
    slider.value = value;
    slider.style.setProperty('--range-value', `${(value - definition.min) / (definition.max - definition.min) * 100}%`);
    slider.setAttribute('aria-valuetext', `${value}${definition.id === 'density' ? ' 千根绒毛' : ''}`);
    const precision = Math.max(2, String(definition.step).split('.')[1]?.length || 0);
    if (!preserveNumber) editor.querySelector(`#number-${definition.id}`).value = definition.id === 'density' ? Math.round(value) : value.toFixed(precision);
  }
  function setParameters(value) {
    parameters = { ...parameters, ...value };
    parameterDefs.forEach((definition) => updateParameterControls(definition));
  }
  for (const definition of parameterDefs) {
    const slider = editor.querySelector(`#param-${definition.id}`);
    const number = editor.querySelector(`#number-${definition.id}`);
    const commit = (input, live = false) => {
      const parsed = input.value === '' ? NaN : Number(input.value);
      if (!Number.isFinite(parsed)) { if (!live) updateParameterControls(definition); return; }
      if (live && (parsed < definition.min || parsed > definition.max)) return;
      const bounded = Math.max(definition.min, Math.min(definition.max, parsed));
      const value = live ? parsed : Number((definition.min + Math.round((bounded - definition.min) / definition.step) * definition.step).toFixed(6));
      const previous = parameters[definition.id];
      parameters[definition.id] = Math.max(definition.min, Math.min(definition.max, value));
      updateParameterControls(definition, live);
      if (previous === parameters[definition.id]) return;
      setSaved(false);
      onParameter?.(definition.id, parameters[definition.id]);
    };
    slider.addEventListener('input', () => commit(slider));
    number.addEventListener('input', () => commit(number, true));
    number.addEventListener('change', () => commit(number));
    number.addEventListener('blur', () => commit(number));
    number.addEventListener('keydown', (event) => { if (event.key === 'Enter') number.blur(); });
  }
  function setPaused(value) {
    paused = Boolean(value);
    motionToggle.innerHTML = icon(paused ? 'play' : 'pause');
    motionToggle.setAttribute('aria-label', paused ? '继续动画' : '暂停动画');
    motionToggle.title = paused ? '继续动画' : '暂停动画';
    motionToggle.setAttribute('aria-pressed', String(paused));
  }
  motionToggle.addEventListener('click', () => { setPaused(!paused); onPause?.(paused); });
  qualityInput.addEventListener('change', () => { setSaved(false); onQuality?.(qualityInput.value); });
  preview.querySelector('.motion-reset').addEventListener('click', () => {
    setPaused(false);
    setSaved(false);
    onReset?.();
    showToast('已恢复默认外形与毛绒参数。');
  });
  async function runAction(button, action, successMessage) {
    if (!action) return;
    button.disabled = true;
    try {
      await action();
      if (button === saveButton) setSaved(true);
      showToast(successMessage);
    } catch (error) {
      showToast(error?.message || '操作未完成，请再试一次。');
    } finally { button.disabled = false; }
  }
  saveButton.addEventListener('click', () => runAction(saveButton, onSave, '已保存到此浏览器，下次打开还在。'));
  preview.querySelector('.capture-button').addEventListener('click', (event) => runAction(event.currentTarget, onCapture, 'PNG 图片已导出。'));
  preview.querySelector('.export-button').addEventListener('click', (event) => runAction(event.currentTarget, onExport, '外形与毛绒参数 JSON 已导出。'));

  setAppearance(appearance);
  setParameters(parameters);
  qualityInput.value = initialQuality;

  return {
    setAppearance, setParameters, setPaused, setSaved,
    setQuality(value) { qualityInput.value = value; },
    getViewportRect() { return viewport.getBoundingClientRect(); },
    setMetrics(metrics) {
      const details = editor.querySelector('.geometry-details');
      details.hidden = !metrics;
      editor.querySelector('.geometry-values').textContent = metrics ? JSON.stringify(metrics, null, 2) : '';
    },
    updateStats({ fps, strands, drawCalls, quality }) {
      if (Number.isFinite(fps)) preview.querySelector('#render-fps').textContent = `${Math.round(fps)} FPS`;
      if (Number.isFinite(strands)) preview.querySelector('#render-strands').textContent = `${Math.round(strands / 1000)}k 绒毛`;
      preview.querySelector('.render-status').title = `${quality || '自动'}画质 · ${Number.isFinite(drawCalls) ? `${drawCalls} 次绘制 · ` : ''}GPU 实例化毛发`;
    },
    setLoading(value) {
      loading.hidden = !value;
      app.setAttribute('aria-busy', String(Boolean(value)));
    },
    showError(message) {
      const error = document.getElementById('webgl-error');
      error.replaceChildren();
      const title = document.createElement('strong');
      title.textContent = '小家伙暂时没能醒来';
      const detail = document.createElement('p');
      detail.textContent = message || '请尝试更新浏览器并开启硬件加速，然后刷新页面。';
      error.append(title, detail);
      error.hidden = false;
      loading.hidden = true;
      app.setAttribute('aria-busy', 'false');
    },
  };
}
