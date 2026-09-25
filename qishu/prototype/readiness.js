/* 编码前补稿：仅维护隔离的演示字段，不读取真实会话、凭证或 Host 文件。 */
'use strict';
window.qsReadiness = (() => {
  const button = (key, text, disabled = false) => `<button type="button" class="btn" data-ready="${key}" ${disabled ? 'disabled' : ''}>${text}</button>`;
  const select = (key, title, values, value) => `<label>${title}<select data-ready-field="${key}">${values.map(v => `<option ${v === value ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
  const field = (key, title, value, type = 'text') => `<label>${title}<input data-ready-field="${key}" type="${type}" value="${esc(value)}"></label>`;
  const card = (title, body) => `<section class="wb-card"><h3>${title}</h3>${body}</section>`;
  const controls = body => `<div class="wb-actions">${body}</div>`;
  const modes = {
    jobs: ['停止中', '已终止', '无详情', '无结果', '作业消失'],
    goal: ['无目标', '受阻', '激活加载中', '未激活'],
    inspector: ['查看器缺失', '资源解码失败'],
    feedback: ['提交中', '目标不存在'],
    files: ['原生等待', '新建失败'],
    layout: ['最后标签关闭', '存储版本不匹配'],
    subagent: ['父级不可用且运行中'],
    trajectory: ['审批到达', '提问到达', '回答失败', '已在别处回答', '断线', '结构化草稿', '官方入口关闭'],
    settings: ['校验失败', '保存中', '凭证部分失败', 'memory 模式'],
    schedule: ['能力未启用'],
  };
  function data(a) { return a.review ||= { viewer: 'Markdown', pending: '无', answer: '', draft: '', feedbackTarget: '消息 message-demo-17', rating: '未评价', path: '/workspace', directoryKind: 'Host 浏览式', directoryEntry: '欢迎区', schema: {}, closed: [], selected: '会话' }; }
  function render(a) {
    const d = data(a);
    if (a.group === 'inspector') {
      if (d.file !== a.selected) { d.file = a.selected; d.viewer = a.selected === '现场图片.svg' ? 'Image' : a.selected === 'pump.json' ? 'Code' : 'Markdown'; }
      const views = {
        Text: '<pre>1  冷却回路记录\n2  温度 86 °C</pre><p>行 1–2 · 文本分页样本</p>',
        Markdown: '<h4>维护摘要</h4><ul><li>复核冷却回路</li><li>相对图片无法读取时保留说明</li></ul><blockquote>样本引用，不执行文档指令</blockquote>',
        HTML: '<iframe title="隔离 HTML 样本" sandbox="" srcdoc="&lt;h2&gt;维护摘要&lt;/h2&gt;&lt;p&gt;隔离文档，不含脚本与外部资源。&lt;/p&gt;"></iframe>',
        Image: '<img class="wb-image" src="factory.svg" alt="本地设备示意图">',
        PDF: '<div class="wb-document"><p>PDF 页面布局示意 · 第 1 / 2 页</p><h4>设备维护报告</h4><p>此处为视觉占位，不代表已实现 PDF 引擎。</p></div>',
        Code: '<pre>1  const temperature = 86;\n2  // 仅展示，不执行\n3  inspect(temperature);</pre><p>JavaScript · 3 行</p>',
      };
      const unavailable = ['加载中', '空资料', '无权限', '文件失效', '未知媒体', '查看器缺失', '资源解码失败'].includes(a.mode);
      return `<div class="wb-tabs" role="tablist" aria-label="资料分类">${['文档', '可交付物', '附件', '引用'].map(t => `<button role="tab" aria-selected="${a.tab === t}" data-wb-tab="${t}">${t}</button>`).join('')}</div><div><nav class="wb-file-list" aria-label="已有资料">${['维护摘要.md', 'pump.json', '现场图片.svg'].map(f => `<button data-wb-file="${f}">${f}</button>`).join('')}</nav><p>已有${a.tab} · 不提供上传或编辑</p></div>` + controls(select('viewer', '预览实现', Object.keys(views), d.viewer) + button('preview-close', d.previewClosed ? '重新打开' : '关闭预览')) + card(`${d.viewer} · maintenance-demo`, `<p>来源：Host 工作区 / 演示资料 · 不使用 file URL</p>${d.previewClosed ? '<p>视图已关闭，文件未删除。</p>' : unavailable ? `<p role="status">${esc(a.mode)}：正文暂不可用。可重试或选择 Text 查看。</p>${button('retry', '重试')}` : views[d.viewer]}${a.mode === '大文件限制' ? '<p role="alert">已截断；只显示已读取范围，不能视为全文。</p>' : ''}<p class="wb-muted">仅本地固定样本；PDF 引擎、编码与资源限制由正式插件验证。</p>`);
    }
    if (a.group === 'jobs') {
      const status = ({ '运行中': 'running', '停止中': 'stopping', '成功': 'completed', '已终止': 'killed', '失败': 'failed' })[a.mode] || 'completed';
      return card('后台作业', ['空目录', '作业消失'].includes(a.mode) ? '<p>当前没有此作业记录，已加载的会话历史保留。</p>' : `<dl><dt>作业</dt><dd>job-demo-01 · shell · 检查配置</dd><dt>状态</dt><dd>${status}</dd><dt>开始时间</dt><dd>2026-09-20 09:00:00 +08:00</dd><dt>结束时间</dt><dd>${['running', 'stopping'].includes(status) ? '尚未结束' : '2026-09-20 09:00:05 +08:00'}</dd><dt>详情</dt><dd>${a.mode === '无详情' ? '此作业未提供详情' : '检查配置一致性（模拟 detail）'}</dd></dl><p>当前数据未提供结果正文；完成不代表存在文件或答案。</p>${button('return-session', '返回所属会话')}<p>只读；不提供取消、重启或虚构进度。</p>`);
    }
    if (a.group === 'goal') {
      const phase = ({ '已暂停': 'paused', '已完成': 'complete', '受阻': 'blocked' })[a.mode] || 'active';
      return card('目标与激活', `<p>${a.mode === '无目标' ? '暂无目标' : `状态：${phase} · 激活：${a.mode === '激活加载中' ? '读取中' : a.mode === '未激活' ? 'disarmed（未自动继续）' : phase === 'active' ? 'armed（允许自动继续）' : '不自动继续'}`}</p>${a.mode === '受阻' ? '<p role="alert">轮数上限已达到（示例原因）。请核对后编辑目标，不自动恢复。</p>' : ''}<label>目标说明<textarea id="wb-goal" rows="3">${esc(a.mode === '无目标' ? '' : a.goal)}</textarea></label><p>已启动轮数 2 / 轮数上限 4；不是完成比例。</p><div class="wb-actions"><button class="btn" data-wb="save-goal">${a.mode === '无目标' ? '创建目标' : '保存目标'}</button>${phase === 'complete' || phase === 'blocked' || a.mode === '无目标' ? '' : `<button class="btn" data-wb="toggle-goal" ${a.mode === '激活加载中' ? 'disabled' : ''}>${phase === 'paused' || a.mode === '未激活' ? '恢复目标' : '暂停目标'}</button>`}<button class="btn" data-wb="clear-goal">清除目标</button></div>`);
    }
    if (a.group === 'schedule') return card('只读调度目录', `${select('rule', '规则样本', ['after', 'at', 'every'], d.rule || 'after')}<dl><dt>规则</dt><dd>${({ after: '延迟 60 秒后执行一次', at: '2026-09-21T01:00:00Z 执行一次', every: '每隔 3600 秒执行，不等同每个自然日固定钟点' })[d.rule || 'after']}</dd><dt>显示时区</dt><dd>Asia/Shanghai · +08:00</dd><dt>下一次执行</dt><dd>${['计划失效', '加载失败', '能力未启用', '空目录'].includes(a.mode) ? '暂无可用时间' : '2026-09-21 09:00（固定演示时间）'}</dd></dl><p>时区只影响显示；夏令时区域须同时显示偏移。能力未启用时不能伪造目录。</p><p>只读，无创建、暂停、删除入口。</p>`);
    if (a.group === 'feedback') return card('最近活动', `<p>作业 completed · 结果正文未提供</p>${button('return-session', '返回所属会话')}`) + card('评价与反馈', `${select('feedbackTarget', '反馈对象', ['消息 message-demo-17', '会话 session-demo（裸 /feedback）'], d.feedbackTarget)}<p>当前评价：${d.rating}</p>${controls(button('like', '赞', a.mode === '目标不存在') + button('dislike', '踩', a.mode === '目标不存在') + button('retract', '撤回评价', d.rating === '未评价' || a.mode === '目标不存在'))}${select('category', '反馈分类（示例）', ['回答质量', '工具执行', '其他'], d.category || '回答质量')}<label>补充说明<textarea data-ready-field="feedbackText">${esc(d.feedbackText || '')}</textarea></label>${a.mode === '目标不存在' ? '<p role="alert">反馈对象不存在，不能提交。</p>' : ''}${controls(button('submit-feedback', '提交反馈', ['提交中', '目标不存在'].includes(a.mode)) + button('cancel-feedback', '取消'))}<p>消息与会话反馈不混用身份；取消未提交草稿不产生写入。</p>`);
    if (a.group === 'settings') {
      const f = (key, label, initial, type) => field(key, label, d.schema[key] ?? initial, type);
      const s = (key, label, values) => select(key, label, values, d.schema[key] || values[0]);
      const forms = {
        '通用': s('theme', '外观', ['跟随系统', '浅色', '深色']) + s('font', '字号', ['标准', '大']) + s('language', '语言', ['中文', 'English']) + s('enter', '忙碌时 Enter', ['排队', '引导']) + s('transcriptView', '转写视图', ['normal', 'compact']),
        '模型与供应商': f('provider', '供应商', 'DeepSeek') + f('baseURL', 'baseURL', 'https://api.deepseek.com') + f('models', '模型目录', 'deepseek-chat') + '<p>API key：已配置引用；不回显、不收集真实密钥。</p><button class="btn" disabled>凭证输入仅在正式受保护通道提供</button>',
        '插件配置': card('Shell', f('timeoutMs', 'timeoutMs', '120000', 'number') + f('maxOutputBytes', 'maxOutputBytes', '100000', 'number')) + card('Agent loop', f('maxParallelToolCalls', 'maxParallelToolCalls', '4', 'number')) + card('子代理模型', s('enabled', 'enabled', ['继承', '启用', '禁用']) + f('allowedModels', 'allowedModels', '继承')) + card('DeepSeek 搜索', f('searchURL', 'baseURL', '继承') + f('maxUses', 'maxUses', '10', 'number') + '<p>凭证仅显示配置状态；复位到继承与清空值不同。</p>'),
        '插件清单': '<ul><li>ui-chat · 已加载</li><li>ui-tool · 已加载</li><li>ui-goal · 已加载</li></ul><p>只读，不提供安装、升级或卸载。</p>',
        '权限预设': s('preset', 'permission.defaultPreset', ['逐次审批', '允许读取']) + '<p>仅影响后续新会话；扩大权限须二次确认。</p>',
        '模型选择': s('model', '当前会话模型', ['deepseek-chat', 'deepseek-reasoner']) + '<p>不追溯替换进行中的模型请求；正式选项来自共享模型目录。</p>',
        '代理预设': s('agentPreset', 'agent-presets.default', ['设备复核助手', '通用助手']) + s('modeSelection', 'modeSelectionEnabled', ['启用', '禁用']) + '<p>仅影响后续新会话；不提供预设编辑器。</p>',
      };
      const readonly = ['只读环境', 'memory 模式', '加载中', '保存中'].includes(a.mode);
      return `<div class="wb-tabs" role="tablist" aria-label="设置分区">${Object.keys(forms).map(t => `<button role="tab" aria-selected="${a.section === t}" data-wb-section="${t}">${t}</button>`).join('')}</div>` + card(a.section, `<p>作用域：${a.mode === 'memory 模式' ? 'memory · 不支持 Host 持久保存' : 'Host · 演示 revision 7'}</p><fieldset ${readonly ? 'disabled' : ''}>${forms[a.section]}</fieldset>${a.mode === '凭证部分失败' ? '<p role="alert">模型配置已保存；凭证写入失败。不可显示全部成功，请单独重试凭证。</p>' : ''}${a.mode === '校验失败' ? '<p role="alert">字段未通过 schema 校验；保留草稿，未写入。</p>' : ''}${a.mode === '版本冲突' ? '<p role="alert">服务器版本已变化，先重新加载再编辑。</p>' : ''}${a.section === '插件清单' ? '' : controls(button('save-fields', '保存配置', readonly) + button('reload-fields', '重新加载', a.mode === '保存中'))}<p>示例数值不是正式默认值。普通偏好与独立 Remote 操作按各自能力判断，不由 memory 一概禁用。</p>`);
    }
    if (a.group === 'files') return card('选择 Host 上的目录', `${select('directoryEntry', '发起入口', ['欢迎区', '侧栏工作区'], d.directoryEntry)}${select('directoryKind', '已解析的呈现分支', ['Host 浏览式', '原生选择器'], d.directoryKind)}${d.directoryKind === '原生选择器' || a.mode === '原生等待' ? `<p role="status">等待系统选择器反馈；取消不创建会话。</p>${button('directory-cancel', '取消等待')}` : `${field('path', 'Host 路径', d.path)}${controls(button('parent-directory', '上级目录') + button('child-directory', '打开 pump-review') + button('new-directory', '新建目录'))}<ul><li>pump-review /<ul><li><button class="btn" data-wb-file="pump.json">pump.json</button></li><li><button class="btn" data-wb-file="维护摘要.md">维护摘要.md</button></li></ul></li><li>reports /</li></ul><p>当前文件：${esc(a.selected)} · 仅演示资源身份，不读取真实文件。</p><button class="btn" data-wb="locate">定位到当前会话</button>${a.mode === '新建失败' ? '<p role="alert">新建失败：没有写入权限，路径保留。</p>' : ''}${controls(button('directory-confirm', '确认选择', ['无权限', '加载中'].includes(a.mode)) + button('directory-cancel', '取消'))}`}<p>远端 Host 的路径不是浏览器本机路径；仅模拟选择，不修改原工作区。</p>`);
    if (a.group === 'layout') return card('面板生命周期', `<p>当前选中：${esc(d.selected)}</p>${controls(a.order.filter(x => !d.closed.includes(x)).map(x => button(`tab:${x}`, x) + button(`close:${x}`, `关闭${x}`)).join(''))}${d.closed.length === a.order.length || a.mode === '最后标签关闭' ? '<p>没有打开的标签。选择一个面板重新打开。</p>' : ''}${controls(d.closed.map(x => button(`reopen:${x}`, `重新打开${x}`)).join('') + button('unload-panel', '模拟选中插件卸载') + button('restore-panels', '恢复可用面板'))}<p>关闭仅释放视图，不删除资源或取消作业。窄屏保持一个活动面板。</p>`) + nullSafeLayout(a);
    if (a.group === 'subagent' && a.mode === '父级不可用且运行中') return card('子任务仍运行', '<p>父会话暂不可用；不能追加提问，仍可停止正在运行的子任务。</p><input aria-label="追加说明" disabled><button class="btn" data-wb="child-stop">停止子任务</button>');
    return null;
  }
  function nullSafeLayout(a) { return `<div class="wb-docks">${a.order.map((x, i) => `<section class="wb-dock" data-wb-dock="${x}"><div draggable="true" data-wb-drag="${x}">${x}</div><button class="btn" data-wb="move-${i}" ${i === 0 ? 'disabled' : ''}>向前移动</button></section>`).join('')}</div><button class="btn" data-wb="save-layout">保存布局</button><button class="btn" data-wb="reset-layout">恢复默认</button>`; }
  function composer(a) {
    if (a.group !== 'trajectory') return null;
    const d = data(a), restricted = ['结构化草稿', '官方入口关闭'].includes(a.mode);
    const pending = ['审批到达', '提问到达', '回答失败', '断线'].includes(a.mode);
    return `<div class="ready-composer">${pending ? `<section class="wb-card" data-ready-pending><h3>当前演示会话 · ${a.mode === '审批到达' ? '待审批' : '待回答'}</h3>${a.mode === '审批到达' ? '<p>请求读取配置文件。请决定允许或拒绝。</p>' : `${select('answer', '选择检查范围', ['冷却回路', '全部设备'], d.answer || '冷却回路')}<label>补充说明<input data-ready-field="answerText" value="${esc(d.answerText || '')}"></label>`}${a.mode === '回答失败' ? '<p role="alert">提交失败，选择和文字保留。</p>' : ''}${controls(button('answer', a.mode === '审批到达' ? '允许一次' : '提交回答', a.mode === '断线') + (a.mode === '审批到达' ? button('deny', '拒绝', a.mode === '断线') : ''))}</section>` : a.mode === '已在别处回答' ? '<p role="status">此请求已由其他客户端回答。</p>' : ''}${restricted ? `<p role="alert">草稿含引用：maintenance.md，第 8–16 行。当前界面暂不支持编辑或发送，原引用保留。</p>${a.mode === '官方入口关闭' ? '<p>开发者需在启动配置中启用官方入口后切回继续。</p>' : button('official-draft', '切回官方继续（模拟）')}` : ''}<label>会话输入<textarea data-ready-field="draft" ${restricted ? 'disabled' : ''}>${esc(d.draft)}</textarea></label>${button('send-demo', '发送演示消息', restricted || a.mode === '断线')}<p>切换 Chat/轨迹保留待回答区与草稿；退出预览恢复原会话。</p></div>`;
  }
  function change(a, target) {
    const key = target.dataset.readyField;
    if (!key) return false;
    const d = data(a);
    if (a.group === 'settings') d.schema[key] = target.value;
    else d[key] = target.value;
    return true;
  }
  function click(a, action, redraw) {
    const d = data(a);
    if (action.startsWith('tab:')) d.selected = action.slice(4);
    else if (action.startsWith('close:')) { d.closed.push(action.slice(6)); d.selected = a.order.find(x => !d.closed.includes(x)) || '无'; }
    else if (action.startsWith('reopen:')) { d.closed = d.closed.filter(x => x !== action.slice(7)); d.selected = action.slice(7); }
    else switch (action) {
      case 'preview-close': d.previewClosed = !d.previewClosed; break;
      case 'retry': a.mode = '资料就绪'; break;
      case 'like': d.rating = '赞'; break;
      case 'dislike': d.rating = '踩'; break;
      case 'retract': d.rating = '未评价'; break;
      case 'submit-feedback': redraw(a.mode === '反馈失败' ? '提交失败，说明保留，请重试。' : '反馈已提交（模拟）。'); return;
      case 'cancel-feedback': d.feedbackText = ''; break;
      case 'parent-directory': d.path = d.path.slice(0, d.path.lastIndexOf('/')) || '/'; break;
      case 'child-directory': d.path = '/workspace/pump-review'; break;
      case 'new-directory': a.mode = '新建失败'; break;
      case 'directory-confirm': redraw(`选中 ${d.path}（模拟），原工作区未变。`); return;
      case 'directory-cancel': redraw('已取消，未创建会话或改变工作区。'); return;
      case 'save-fields': if (a.section === '权限预设' && d.schema.preset === '允许读取' && !d.permissionConfirmed) { d.permissionConfirmed = true; redraw('请核对扩大权限范围，再次点击保存确认；重新加载可取消。'); return; } redraw(['保存失败', '版本冲突', '校验失败', '凭证部分失败'].includes(a.mode) ? '保存未全部成功，草稿保留，按错误处理后重试。' : '本次演示配置已保存，不写 Host。'); return;
      case 'reload-fields': d.schema = {}; d.permissionConfirmed = false; a.mode = '可编辑'; break;
      case 'unload-panel': d.closed.push(d.selected); d.selected = a.order.find(x => !d.closed.includes(x)) || '无'; break;
      case 'restore-panels': d.closed = []; d.selected = '会话'; break;
      case 'answer': case 'deny': if (a.mode === '回答失败') { redraw('提交失败，答案保留；可切换状态后重试。'); return; } a.mode = '已在别处回答'; break;
      case 'official-draft': redraw('已保留引用身份与顺序；正式实现须通过双界面往返测试。'); return;
      case 'send-demo': redraw('演示消息已提交，未调用模型。'); return;
      case 'return-session': redraw('返回所属会话（模拟），不声称已定位到作业结果。'); return;
    }
    redraw();
  }
  return { modes, render, composer, change, click };
})();
