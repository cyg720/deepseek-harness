/* 合并第二优先工作台原型：复用现有外壳，仅操作隔离的本地演示状态。 */
'use strict';
(() => {
  const catalog = {
    inspector: ['W1', '检查器与资料', 'file', ['资料就绪', '加载中', '空资料', '文件失效', '无权限', '未知媒体', '大文件限制']],
    feedback: ['W2', '通知与反馈', 'info', ['运行中', '已完成', '失败', '已读', '反馈失败']],
    files: ['W3', '工作区与文件', 'folder', ['目录就绪', '选择目录', '加载中', '空目录', '无权限', '文件已移动']],
    layout: ['W4', '多面板布局', 'grid', ['标准布局', '专注布局', '插件缺失', '配置损坏']],
    jobs: ['W5', '后台作业', 'terminal', ['运行中', '成功', '失败', '空目录', '连接中断']],
    schedule: ['W6', '调度目录', 'calendar', ['计划就绪', '空目录', '计划失效', '加载失败']],
    goal: ['W7', '目标管理', 'spark', ['进行中', '已暂停', '已完成', '保存失败', '版本冲突']],
    subagent: ['W8', '子代理协作', 'agent', ['协作中', '加载中', '一次性只读', '可续聊', '父会话不可用']],
    trajectory: ['W9', '请求轨迹', 'chart', ['请求就绪', '加载中', '历史缺窗', '加载失败', '媒体不可用']],
    settings: ['W10', '设置与模型', 'settings', ['可编辑', '加载中', '保存失败', '版本冲突', '只读环境']],
    integrations: ['W11', '外部系统授权', 'globe', ['未授权', '授权中', '已授权', '请求超时', '已撤销', '权限不足']],
    brand: ['W12', '品牌与外观', 'spark', ['浅色预览', '深色预览', '窄屏预览', '官方入口说明']],
  };
  // 补稿状态集中扩展现有入口，避免建立第二个互不联动的工作台。
  for (const [group, modes] of Object.entries(qsReadiness.modes)) catalog[group][3].push(...modes);
  const sections = ['通用', '模型与供应商', '插件配置', '插件清单', '权限预设', '模型选择', '代理预设'];
  const defaults = { '通用': '标准阅读密度', '模型与供应商': 'DeepSeek · 已配置凭证引用（模拟）', '插件配置': 'Shell 执行需审批', '插件清单': '只读', '权限预设': '逐次审批', '模型选择': 'DeepSeek V3.2', '代理预设': '设备复核助手' };
  const initialOrder = ['会话', '检查器', '作业'];
  const storageKey = 'qs-prototype-workbench-layout-v1';
  let active = null, drag = null, lastFocus = null;
  const originalRender = renderApp, originalMenu = systemDemoMenu;
  const sessionKey = () => `${state.workspace}/${ws().current || 'new'}`;
  const button = (action, label, primary = false, disabled = false) => `<button type="button" class="btn ${primary ? 'primary' : ''}" data-wb="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  const actions = html => `<div class="wb-actions">${html}</div>`;
  const card = (title, body) => `<section class="wb-card"><h3>${title}</h3>${body}</section>`;
  const badge = text => `<span class="wb-badge">${esc(text)}</span>`;
  const files = ['维护摘要.md', 'pump.json', '现场图片.svg'];
  const warning = {
    '加载中': '正在读取演示数据，请稍候。', '空资料': '当前会话还没有可供查看的资料。', '文件失效': '这个文件已被移除，原对话记录仍然保留。',
    '无权限': '没有访问该资源的权限；请联系工作区管理员。', '未知媒体': '暂不支持内嵌这种文件格式，可查看来源说明。', '大文件限制': '文件超过预览限制，仅显示摘要，不自动加载全文。',
    '空目录': '当前目录没有记录。', '文件已移动': '文件位置已经变化，请刷新列表。', '插件缺失': '作业面板当前不可用，其余面板仍可使用。', '配置损坏': '保存的布局无法读取，可恢复默认布局。',
    '连接中断': '连接中断，以下为最后一次收到的状态，不代表任务停止。', '计划失效': '原计划已经失效，不再提供下一次执行时间。', '加载失败': '暂时无法读取数据，可重试；已有内容保留。',
    '保存失败': '模拟保存失败。输入内容已保留，请重试。', '版本冲突': '数据已被另一处更新，保留本地修改；请核对后重试。',
    '父会话不可用': '父会话暂不可用；已停止的子会话暂不能继续提问。', '历史缺窗': '这个请求的部分记录不在当前历史窗口，可加载更早记录。', '媒体不可用': '没有取得有效图片地址，保留文本说明。',
    '只读环境': '当前环境仅允许查看设置，保存操作不可用。', '权限不足': '授权范围不包含此操作，请重新核对访问权限。',
    '请求超时': '模拟请求超时。不会自动重放可能产生副作用的操作。', '已撤销': '演示授权已撤销，后续受保护请求已禁用。',
  };
  // 布局只存类型与顺序，不存会话数据、凭证或用户业务配置。
  function loadOrder() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved?.version === 1 && Array.isArray(saved.order) && saved.order.length === 3 && new Set(saved.order).size === 3 && saved.order.every(x => initialOrder.includes(x))) return saved.order;
    } catch { /* 浏览器拒绝存储或内容损坏时使用默认布局。 */ }
    return [...initialOrder];
  }
  systemDemoMenu = function () {
    return originalMenu() + `<h3 class="system-menu-title">第二优先 · 工作台差异化（二合一）</h3><div class="modal-list">${Object.entries(catalog).map(([id, [code, title, glyph]]) => `<button class="choice-row" data-wb-open="${id}">${icon(glyph)}<span><strong>${code} · ${title}</strong><small>本地交互演示 · 不连接业务服务</small></span>${icon('next')}</button>`).join('')}</div>`;
  };
  function start(group) {
    resetSystemDemo();
    document.dispatchEvent(new Event('qs-prototype-leave-diagnostics'));
    active = { group, mode: catalog[group][3][0], key: sessionKey(), selected: files[0], tab: '文档', section: '通用', goal: '完成 3 号泵冷却回路复核', draft: defaults['通用'], saved: defaults['通用'], values: { ...defaults }, drafts: { ...defaults }, order: loadOrder(), note: '', feedback: false, child: false };
    closeModal(); renderApp();
  }
  function notice() {
    const text = warning[active.mode];
    if (!text) return '';
    const pending = active.mode === '加载中';
    return `<div class="wb-notice ${pending ? '' : 'wb-warning'}" role="${pending ? 'status' : 'alert'}">${icon(pending ? 'refresh' : 'info')}<span>${text}</span>${['加载失败', '文件已移动', '连接中断', '文件失效'].includes(active.mode) ? button('retry', '重新读取') : ''}</div>`;
  }
  function content() {
    const a = active;
    const revised = qsReadiness.render(a);
    if (revised !== null) return revised;
    switch (a.group) {
      case 'subagent': return card('协作谱系', `<p>主会话 / 冷却回路复核 → 配置核查助手</p><div class="wb-event">${icon('agent')}<div><strong>配置核查助手</strong><p>任务：比对配置与维护记录</p></div>${badge(a.mode)}</div>${actions(button('child', a.child ? '返回主会话视图' : '查看子会话', true))}${a.child ? '<blockquote>子会话记录：已读取配置，发现温度阈值偏差。</blockquote>' : ''}<label for="wb-child-input">追加说明</label><input id="wb-child-input" placeholder="输入追加说明" ${['一次性只读', '父会话不可用', '加载中'].includes(a.mode) ? 'disabled' : ''}>${actions(button('child-send', '发送说明', false, ['一次性只读', '父会话不可用', '加载中'].includes(a.mode)) + (a.mode === '协作中' ? button('child-stop', '停止子任务') : ''))}<p class="wb-muted">一次性任务仅可回看；父级不可用时不开放续聊。</p>`);
      case 'trajectory': return `<div class="wb-tabs"><button data-wb="chat-view">对话摘要</button><button data-wb="trace-view">请求轨迹</button></div>${a.chat ? card('对话摘要', '<p>已检查配置，建议复核冷却回路。</p>') : card('第 2 轮 · 请求 3', `<p>输入 1,240 / 输出 210 token（模拟统计）</p><dl class="wb-metrics"><div><dt>首字延迟</dt><dd>0.8 秒</dd></div><div><dt>总耗时</dt><dd>4.2 秒</dd></div><div><dt>模型</dt><dd>DeepSeek</dd></div></dl><details><summary>展开上下文组成</summary><p>系统指令、工具定义、历史消息分别记录；缺窗不补造内容。</p></details><details><summary>展开请求内容（模拟）</summary><pre>${esc('<system-reminder>仅用于原型验证的文本，不作为指令执行。</system-reminder>')}</pre></details>${a.mode === '历史缺窗' ? button('retry', '加载更早记录') : ''}`)}`;
      case 'integrations': return card('外部系统 · 待确认接入对象', `${badge(a.mode)}<p>此页用于评审授权与恢复流程；尚未确定真实系统和身份方案。</p><dl><dt>演示权限</dt><dd>读取维护记录 · 不包含写入与删除</dd><dt>凭证</dt><dd>由宿主持有，浏览器不存储密钥</dd></dl>${actions(button('authorize', '模拟授权', true, a.mode === '授权中') + button('protected', '模拟读取', false, a.mode !== '已授权') + button('revoke', '撤销授权', false, a.mode !== '已授权'))}<p class="wb-muted">静态登录不代表拥有真实系统访问权限。</p>`);
      case 'brand': return card('奇术 · AI WORKSPACE', `${brand()}<p>会话、资料与任务，在一个工作台中衔接。</p>${actions(button('light', '浅色主题') + button('dark', '深色主题'))}<p>${a.mode === '官方入口说明' ? '官方界面入口仅在开发者配置允许时可见；本原型不连接或跳转生产服务。' : a.mode === '窄屏预览' ? '窄屏沿用原工作台折叠导航和右栏，标识保持可辨。' : '标识、名称、边框和字体沿用现有样式规范。'}</p>`);
    }
    return '';
  }
  function decorate() {
    if (!active) return;
    if (active.key !== sessionKey() || !$('.center')) { active = null; return; }
    const [code, title, glyph, modes] = catalog[active.group];
    document.querySelectorAll('.p2-bar').forEach(el => el.remove());
    $('.center').insertAdjacentHTML('afterbegin', `<div class="p2-bar wb-bar"><label>工作台能力 <select id="wb-group" aria-label="工作台能力">${Object.entries(catalog).map(([id, [c, t]]) => `<option value="${id}" ${id === active.group ? 'selected' : ''}>${c} · ${t}</option>`).join('')}</select></label><label>演示状态 <select id="wb-mode" aria-label="工作台演示状态">${modes.map(m => `<option ${m === active.mode ? 'selected' : ''}>${m}</option>`).join('')}</select></label>${button('exit', '退出预览')}</div>`);
    $('#center-scroll').innerHTML = `<div class="wb-content"><header class="wb-heading"><span class="wb-emblem">${icon(glyph)}</span><div><span class="wb-kicker">第二优先 / ${code}</span><h2>${title}</h2></div>${badge(active.mode)}</header><p class="wb-muted">本地固定样本 · 不调用模型、不修改真实文件、不连接第三方服务。</p>${notice()}${content()}<p id="wb-status" class="wb-status" role="status" aria-live="polite">${esc(active.note)}</p></div>`;
    // 标签与内容建立可访问关联，仅当前标签进入 Tab 顺序。
    const tabs = $('.wb-tabs');
    if (tabs) {
      const panel = tabs.nextElementSibling;
      panel.id = 'wb-tabpanel'; panel.setAttribute('role', 'tabpanel');
      tabs.querySelectorAll('[role=tab]').forEach((tab, i) => {
        tab.id = `wb-tab-${i}`; tab.setAttribute('aria-controls', panel.id);
        tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
        if (tab.tabIndex === 0) panel.setAttribute('aria-labelledby', tab.id);
      });
    }
    // 空会话的原输入位于欢迎区，替换阅读内容后需重建外部稳定输入宿主。
    if (!$('.composer-shell') && active.group === 'trajectory') $('.center-footer').insertAdjacentHTML('beforebegin', '<div class="chat-composer"><div class="composer-shell"></div></div>');
    const composer = $('.composer-shell');
    if (composer) composer.innerHTML = qsReadiness.composer(active) ?? '<p class="wb-muted">正在评审工作台能力；退出预览恢复原会话与草稿。</p>';
    const right = $('#right-content');
    if (right) right.innerHTML = `<div class="wb-context"><span class="wb-kicker">当前演示上下文</span><h3>冷却回路复核</h3><p>3 号泵 · 设备维护工作区</p>${badge('仅当前预览')}<hr><h4>资料与任务</h4><p>维护摘要.md</p><p>配置核查 · 已完成</p><p>现场复核 · 待确认</p><hr><p class="wb-muted">当前资源和操作只在演示中关联，不改变原工作区内容。</p></div>`;
  }
  renderApp = function () { originalRender(); decorate(); };
  function redraw(note = '') { active.note = note; renderApp(); }
  function confirm(title, text, action) {
    lastFocus = document.activeElement?.dataset.wb;
    openModal(title, `<p>${text}</p><p class="wb-muted">仅本地演示，不产生真实业务操作。</p>${actions(button('cancel', '取消') + button(action, '确认（模拟）', true))}`);
  }
  $('#modal').addEventListener('close', () => { if (active && lastFocus) { $(`[data-wb="${lastFocus}"]`)?.focus(); lastFocus = null; } });
  // 只处理扩展命名空间；原工作台的登录、发送与审批保持原事件归属。
  document.addEventListener('click', event => {
    if (event.target.closest('[data-p2-open], [data-action="logout"], [data-action="new-chat"], [data-action="system-start"], [data-action="interaction-start"], [data-action="conversation-scenario"]')) active = null;
    const launch = event.target.closest('[data-wb-open]');
    if (launch) { start(launch.dataset.wbOpen); return; }
    if (!active) return;
    const ready = event.target.closest('[data-ready]');
    if (ready && !ready.disabled) { qsReadiness.click(active, ready.dataset.ready, redraw); return; }
    const file = event.target.closest('[data-wb-file]'), tab = event.target.closest('[data-wb-tab]'), section = event.target.closest('[data-wb-section]');
    if (file) { active.selected = file.dataset.wbFile; redraw('已打开演示资料。'); return; }
    if (tab) { active.tab = tab.dataset.wbTab; redraw(); return; }
    if (section) { active.section = section.dataset.wbSection; active.draft = active.drafts[active.section]; active.saved = active.values[active.section]; redraw(); return; }
    const el = event.target.closest('[data-wb]'); if (!el || el.disabled) return;
    const action = el.dataset.wb;
    if (action.startsWith('move-')) { const i = Number(action.slice(5)); if (i > 0) [active.order[i - 1], active.order[i]] = [active.order[i], active.order[i - 1]]; redraw('面板顺序已调整，保存后可恢复。'); return; }
    switch (action) {
      case 'exit': active = null; renderApp(); break;
      case 'retry': active.mode = catalog[active.group][3][0]; redraw('演示数据已恢复。'); break;
      case 'read': active.mode = '已读'; redraw('通知已标记为已读。'); break;
      case 'notify': active.mode = '已完成'; redraw('任务结果已保留，切回可查看。'); toast('复核任务已完成（模拟）'); break;
      case 'feedback': if (active.mode === '反馈失败') { active.mode = '已完成'; redraw('提交失败（模拟），反馈保留，请重试。'); } else { active.feedback = true; redraw('反馈已记录（模拟），不会重复提交。'); } break;
      case 'choose-directory': confirm('选择工作区', '演示目录：/workspace/pump-review。取消会保留原工作区。', 'directory-ok'); break;
      case 'directory-ok': closeModal(); active.mode = '目录就绪'; redraw('已选演示目录，原工作区未变。'); break;
      case 'locate': redraw(`已在当前演示会话定位 ${active.selected}，不会向真实会话发送消息。`); break;
      case 'save-layout': try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, order: active.order })); redraw('布局已保存到本机，可退出后重新进入验证。'); } catch { redraw('浏览器不允许保存，当前布局仍可使用。'); } break;
      case 'reset-layout': active.order = [...initialOrder]; active.mode = '标准布局'; redraw('已恢复默认布局，点击保存后覆盖原记录。'); break;
      case 'save-goal': if (['保存失败', '版本冲突'].includes(active.mode)) { active.mode = '进行中'; redraw('保存未成功（模拟），保留输入，可再次保存。'); } else redraw('目标已保存（模拟）。'); break;
      case 'toggle-goal': active.mode = active.mode === '已暂停' ? '进行中' : '已暂停'; redraw('目标状态已更新（模拟）。'); break;
      case 'clear-goal': confirm('清除目标', '确认清除当前演示目标？原会话内容将保留。', 'goal-cleared'); break;
      case 'goal-cleared': closeModal(); active.goal = ''; redraw('演示目标已清除，会话记录保留。'); break;
      case 'child': active.child = !active.child; redraw(); break;
      case 'child-send': redraw('追加说明已发送到演示子会话，未调用真实服务。'); break;
      case 'child-stop': active.mode = '一次性只读'; redraw('演示子任务已停止，记录仍可回看。'); break;
      case 'chat-view': active.chat = true; redraw(); break;
      case 'trace-view': active.chat = false; redraw(); break;
      case 'save-setting': if (!active.draft.trim()) { redraw('配置值不能为空，未保存。'); break; } if (['保存失败', '版本冲突'].includes(active.mode)) { active.mode = '可编辑'; redraw('保存未成功（模拟），输入保留，请核对后重试。'); } else if (active.section === '权限预设') confirm('更改权限预设', '扩大权限可能允许更多操作，请核对演示方案后确认。', 'setting-ok'); else { active.saved = active.draft; active.values[active.section] = active.saved; redraw('配置已在本次预览中生效（模拟）。'); } break;
      case 'setting-ok': closeModal(); active.saved = active.draft; active.values[active.section] = active.saved; redraw('权限预设已更新（模拟）。'); break;
      case 'authorize': confirm('模拟授权', '只允许读取维护记录，不包含写入或删除。不收集账号、票据或密钥。', 'authorized'); break;
      case 'authorized': closeModal(); active.mode = '已授权'; redraw('演示授权已建立，仅限本次预览。'); break;
      case 'protected': if (active.mode === '已授权') redraw('读取成功（模拟）：3 条维护记录。'); break;
      case 'revoke': confirm('撤销授权', '撤销后不再允许读取受保护的演示资源。', 'revoked'); break;
      case 'revoked': closeModal(); active.mode = '已撤销'; redraw('授权已撤销，读取入口已禁用。'); break;
      case 'light': case 'dark': state.settings.theme = action; redraw(); break;
      case 'cancel': closeModal(); break;
    }
  }, true);
  document.addEventListener('input', event => {
    if (!active) return;
    qsReadiness.change(active, event.target);
    if (event.target.id === 'wb-goal') active.goal = event.target.value;
    if (event.target.id === 'wb-setting') { active.draft = event.target.value; active.drafts[active.section] = active.draft; }
    if (event.target.id === 'wb-feedback') active.feedbackText = event.target.value;
  });
  // 选择字段切换样本，文字字段只保存草稿，避免逐字重绘丢失焦点。
  document.addEventListener('change', event => {
    if (active && event.target.matches('select[data-ready-field]') && qsReadiness.change(active, event.target)) redraw();
  });
  // 左右方向键及首尾键切换分区，重绘后将焦点交还新标签。
  document.addEventListener('keydown', event => {
    const tab = event.target.closest('.wb-tabs [role=tab]');
    if (!active || !tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const tabs = [...tab.parentElement.querySelectorAll('[role=tab]')];
    const current = tabs.indexOf(tab);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[index].click(); $(`#wb-tab-${index}`)?.focus();
  }, true);
  document.addEventListener('change', event => {
    if (event.target.id === 'wb-group') start(event.target.value);
    if (event.target.id === 'wb-mode' && active) { active.mode = event.target.value; redraw(); }
  });
  document.addEventListener('dragstart', event => { const tab = event.target.closest('[data-wb-drag]'); if (tab) { drag = tab.dataset.wbDrag; event.dataTransfer.setData('text/plain', drag); } });
  document.addEventListener('dragover', event => { if (drag && event.target.closest('[data-wb-dock]')) event.preventDefault(); });
  document.addEventListener('drop', event => {
    const target = event.target.closest('[data-wb-dock]'); if (!active || !drag || !target) return;
    event.preventDefault(); const from = active.order.indexOf(drag), to = active.order.indexOf(target.dataset.wbDock);
    if (from >= 0 && to >= 0) { active.order.splice(to, 0, active.order.splice(from, 1)[0]); redraw('拖拽顺序已更新，可保存布局。'); } drag = null;
  });
  document.addEventListener('dragend', () => { drag = null; });
})();
