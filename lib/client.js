/**
 * 豆包工作台 — 客户端半。
 *
 * 输入框左侧一个按钮，点开是工作台列表：搜索、看每个工作台的技能栈与
 * 典型任务、点一下就切换。切换后 Host 把该工作台的场景提示词注入本
 * Session 的系统提示，所以这里只需要发一个请求、再刷新自己的显示。
 *
 * 面板用 fixed 浮层 + createPortal 挂到 body：composer 是固定定位后代的
 * 包含块，留在里面的浮层会被裁掉。
 */
window.__ModuleLoader__.load({
  id: 'dsh-workbench',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const NS = 'workbench'
    const ROUTE = '/dsh-workbench'

    /* ------------------------------------------------------------------ *
     * 文案
     * ------------------------------------------------------------------ */

    const zh = {
      'button.none': '工作台',
      'button.title': '豆包工作台',
      'panel.title': '豆包工作台',
      'panel.subtitle': '选一个场景，规则会写进本会话的系统提示',
      'panel.search': '搜索工作台、技能或用途',
      'panel.count': '{0} 个',
      'panel.none': '未选择工作台。选一个后，它的场景规则会进入本会话的系统提示。',
      'panel.clear': '取消当前工作台',
      'panel.detail': '查看技能与任务',
      'panel.back': '返回列表',
      'panel.skills': '配套技能',
      'panel.skillsLocal': '本地已装 {0}/{1}',
      'panel.plugins': '预置插件',
      'panel.suggestions': '典型任务',
      'panel.noSkill': '这个工作台没有登记技能。',
      'panel.current': '当前选中',
      'panel.loading': '正在读取工作台…',
      'panel.empty': '没有匹配的工作台。',
      'panel.error': '读取失败：{0}',
      'panel.retry': '重试',
      'panel.uninstalled': '未安装',
      'panel.install': '安装',
      'panel.installAll': '安装全部（{0}）',
      'panel.installing': '安装中…',
      'panel.noSource': '本机无源文件',
      'panel.installed': '已安装',
      'panel.installDone': '已安装 {0} 个',
      'panel.installSkipped': '跳过 {0} 个',
      'panel.installFailed': '失败 {0} 个',
      'panel.installHint': '把本机已有的技能文件复制进 DSH 技能库，不联网',
      'panel.footer': '共 {0} 个工作台 · {1}',
      'panel.source': '数据来源：{0}',
      'panel.settings': '注入选项',
      'panel.optRouting': '附带技能清单与路由规则',
      'panel.optSuggestions': '附带典型任务示例',
      'panel.pickHint': '点一下选中；选中后面板收起',
      'panel.unpickHint': '再点一下取消选择',
      'panel.useThis': '用这个工作台',
    }

    const en = {
      'button.none': 'Workbench',
      'button.title': 'Workbench',
      'panel.title': 'Workbench',
      'panel.subtitle': 'Pick a scene; its rules join this session\u2019s system prompt',
      'panel.search': 'Search workbenches, skills or purpose',
      'panel.count': '{0}',
      'panel.none': 'No workbench selected. Picking one adds its scene rules to this session.',
      'panel.clear': 'Clear the current workbench',
      'panel.detail': 'Skills and tasks',
      'panel.back': 'Back',
      'panel.skills': 'Paired skills',
      'panel.skillsLocal': '{0} of {1} installed',
      'panel.plugins': 'Bundled plugins',
      'panel.suggestions': 'Typical tasks',
      'panel.noSkill': 'This workbench registers no skills.',
      'panel.current': 'Selected',
      'panel.loading': 'Loading workbenches\u2026',
      'panel.empty': 'No workbench matched.',
      'panel.error': 'Could not load: {0}',
      'panel.retry': 'Retry',
      'panel.uninstalled': 'not installed',
      'panel.install': 'Install',
      'panel.installAll': 'Install all ({0})',
      'panel.installing': 'Installing…',
      'panel.noSource': 'no local source',
      'panel.installed': 'installed',
      'panel.installDone': '{0} installed',
      'panel.installSkipped': '{0} skipped',
      'panel.installFailed': '{0} failed',
      'panel.installHint': 'Copies existing local skill files into the DSH skill library; no network',
      'panel.footer': '{0} workbenches · {1}',
      'panel.source': 'Source: {0}',
      'panel.settings': 'Inject',
      'panel.optRouting': 'Skill list and routing rules',
      'panel.optSuggestions': 'Typical task examples',
      'panel.pickHint': 'Click to select; the panel closes',
      'panel.unpickHint': 'Click again to deselect',
      'panel.useThis': 'Use this workbench',
    }

    /* ------------------------------------------------------------------ *
     * 样式：只用宿主主题 token，字色/边框跟随明暗切换
     * ------------------------------------------------------------------ */

    const CSS = `
.wb-root { display: inline-flex; align-items: center; min-width: 0; }
.wb-button {
  display: inline-flex; align-items: center; gap: 6px; max-width: 190px;
  height: 28px; padding: 0 8px; border-radius: 8px;
  border: 1px solid transparent; background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap;
}
.wb-button:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.wb-button[data-active="true"] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-border-l1);
}
.wb-button[aria-expanded="true"] { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.wb-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.wb-label { overflow: hidden; text-overflow: ellipsis; }
.wb-panel {
  position: fixed; z-index: 2500; box-sizing: border-box;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, .22);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
.wb-head { display: flex; flex-direction: column; gap: 8px; padding: 12px 12px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.wb-head-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.wb-title { font-size: 13.5px; font-weight: 600; }
.wb-sub { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.wb-search {
  width: 100%; box-sizing: border-box; height: 32px; padding: 0 10px;
  border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; outline: none;
}
.wb-search::placeholder { color: var(--dsw-alias-state-idle-primary); }
.wb-search:focus { border-color: var(--dsw-alias-brand-primary); }
.wb-body { overflow-y: auto; padding: 6px 6px 8px; overscroll-behavior: contain; }
.wb-row {
  display: flex; gap: 10px; width: 100%; box-sizing: border-box; text-align: left;
  align-items: flex-start; padding: 8px 10px; border: 0; border-radius: 10px;
  background: transparent; color: inherit; font: inherit; cursor: pointer;
}
.wb-row:hover, .wb-row:focus-visible { background: var(--dsw-alias-bg-layer-2); outline: none; }
.wb-row[data-selected="true"] { background: var(--dsw-alias-bg-layer-2); }
.wb-dot {
  flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%;
  background: var(--dsw-alias-border-l2);
}
.wb-row[data-selected="true"] .wb-dot { background: var(--dsw-alias-brand-primary); }
.wb-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.wb-name { font-size: 13px; font-weight: 600; line-height: 1.35; display: flex; align-items: center; gap: 6px; }
.wb-badge {
  padding: 1px 5px; border-radius: 5px; font-size: 10px; font-weight: 500;
  color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2);
}
.wb-intro {
  font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.wb-meta { display: flex; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.wb-more {
  flex: none; align-self: center; padding: 2px 6px; border-radius: 6px;
  border: 1px solid transparent; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11.5px;
}
.wb-more:hover { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.wb-detail { padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.wb-detail p { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
.wb-h { font-size: 11.5px; font-weight: 600; letter-spacing: .02em; color: var(--dsw-alias-label-secondary); }
.wb-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.wb-list li { display: flex; gap: 6px; font-size: 12px; line-height: 1.45; }
.wb-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.wb-task { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.wb-foot { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--dsw-alias-border-l1); }
.wb-opt { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.wb-opt input { accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
.wb-actions { display: flex; gap: 8px; align-items: center; }
.wb-link {
  padding: 0; border: 0; background: transparent; cursor: pointer; font: inherit;
  font-size: 12px; color: var(--dsw-alias-brand-primary);
}
.wb-link:hover { text-decoration: underline; }
.wb-link[disabled] { color: var(--dsw-alias-state-idle-primary); cursor: default; text-decoration: none; }
.wb-state { padding: 20px 14px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 1.6; }
.wb-error { color: var(--dsw-alias-state-error-primary); }
.wb-retry {
  margin-top: 8px; height: 26px; padding: 0 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px;
}
.wb-count { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.wb-skill-row { display: flex; align-items: center; gap: 6px; }
.wb-skill-row .wb-skill-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-install {
  flex: none; height: 22px; padding: 0 8px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-brand-primary); font: inherit; font-size: 11.5px;
}
.wb-install:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.wb-install:disabled { color: var(--dsw-alias-state-idle-primary); cursor: default; }
.wb-installbar {
  display: flex; align-items: center; gap: 8px; padding: 8px 0 2px; flex-wrap: wrap;
}
.wb-installbar .wb-hint { font-size: 11.5px; color: var(--dsw-alias-label-secondary); flex: 1; min-width: 120px; }
.wb-notice { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.wb-notice[data-tone="ok"] { color: var(--dsw-alias-brand-primary); }
.wb-notice[data-tone="bad"] { color: var(--dsw-alias-state-error-primary); }
`

    /* ------------------------------------------------------------------ *
     * 小工具
     * ------------------------------------------------------------------ */

    function useTranslator(localeService) {
      const usable = localeService
        && typeof localeService.bind === 'function'
        && typeof localeService.subscribe === 'function'
        && typeof localeService.getSnapshot === 'function'
      React.useSyncExternalStore(
        (listener) => (usable ? localeService.subscribe(listener) : () => {}),
        () => (usable ? localeService.getSnapshot() : null),
        () => (usable ? localeService.getSnapshot() : null),
      )
      return React.useMemo(() => {
        // 真实服务签名是 t(key, params)；占位符写成 {0}、{1}。
        if (usable) return localeService.bind(NS)
        return (key, params) => {
          const template = zh[key] ?? key
          if (params === undefined || params === null) return template
          return template.replace(/\{(\w+)\}/g, (match, name) => {
            if (typeof params === 'object') return name in params ? String(params[name]) : match
            return match
          })
        }
      }, [usable, localeService])
    }

    /** t(key, {0: x}) 的简写，避免每处都写对象字面量。 */
    function fill(t, key, ...values) {
      if (values.length === 0) return t(key)
      const params = {}
      values.forEach((value, index) => { params[String(index)] = value })
      return t(key, params)
    }

    /** 浮层几何：贴在按钮上方，夹在视口内。 */
    function panelGeometry(anchor) {
      const rect = anchor.getBoundingClientRect()
      const width = Math.max(340, Math.min(480, window.innerWidth - 24))
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - 12 - width))
      const bottom = Math.max(12, window.innerHeight - rect.top + 8)
      const maxHeight = Math.max(300, Math.min(580, rect.top - 16))
      return { left, bottom, width, maxHeight }
    }

    async function call(action, init) {
      const response = await fetch(`${ROUTE}/${action}`, {
        method: init === undefined ? 'GET' : 'POST',
        headers: init === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
        body: init === undefined ? undefined : JSON.stringify(init),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (payload?.ok !== true) throw new Error(String(payload?.error ?? `HTTP ${response.status}`))
      return payload
    }

    /* ------------------------------------------------------------------ *
     * 打开状态放在模块级
     *
     * composer 的工具栏会在点击后重新注册 slot，把组件卸载再挂回来。
     * 状态若留在组件内部的 useState 里，重挂载时它会回到初值 —— 用户看到
     * 的就是「点一下面板/按钮就没了」。放在模块级并由订阅者广播，重挂载
     * 后仍是打开的，且多个实例同时存在也不会打架。
     * ------------------------------------------------------------------ */

    const openStore = { value: false, listeners: new Set() }

    /**
     * 排障埋点：把浏览器侧事件写到 Host 的 trace.log。
     * 出问题时用户只需点一下按钮，之后读日志就能定位，不用开浏览器。
     */
    function trace(event, extra) {
      try {
        const detail = extra === undefined ? '' : ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`
        void fetch(`${ROUTE}/trace`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ line: `[client] ${event}${detail}` }),
        }).catch(() => {})
      } catch {
        /* 埋点本身绝不能影响功能 */
      }
    }

    function setOpenState(next) {
      const value = typeof next === 'function' ? next(openStore.value) : next
      if (value === openStore.value) {
        trace('setOpenState:noop', { value })
        return
      }
      openStore.value = value
      trace('setOpenState', { value, listeners: openStore.listeners.size })
      for (const listener of [...openStore.listeners]) {
        try {
          listener()
        } catch (error) {
          trace('listener:threw', String(error))
        }
      }
    }

    function useOpenState() {
      // 用 useState 存快照值而不是计数器：只有值真的变了才重渲染，
      // 避免「订阅回调 → 重渲染 → 再订阅」把 React 拖进更新风暴。
      const [value, setValue] = React.useState(openStore.value)
      React.useEffect(() => {
        const listener = () => setValue(openStore.value)
        openStore.listeners.add(listener)
        // 订阅建立前可能已经变过，补一次
        if (openStore.value !== value) setValue(openStore.value)
        trace('mount', { open: openStore.value })
        return () => {
          openStore.listeners.delete(listener)
          trace('unmount', { openStill: openStore.value })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return [value, setOpenState]
    }

    /* ------------------------------------------------------------------ *
     * 组件
     * ------------------------------------------------------------------ */

    function WorkbenchPicker(props) {
      const { sessionId, localeService } = props
      const t = useTranslator(localeService)

      const [open, setOpen] = useOpenState()
      const [state, setState] = React.useState(null)
      const [status, setStatus] = React.useState('idle')
      const [error, setError] = React.useState('')
      const [query, setQuery] = React.useState('')
      const [detail, setDetail] = React.useState(null)
      const [detailStatus, setDetailStatus] = React.useState('idle')
      const [geo, setGeo] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const anchorRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const searchRef = React.useRef(null)
      const runRef = React.useRef(0)

      const load = React.useCallback(() => {
        const run = ++runRef.current
        setStatus('loading')
        setError('')
        call(`state?sessionId=${encodeURIComponent(sessionId ?? '')}`).then(
          (payload) => {
            if (runRef.current !== run) return
            setState(payload)
            setStatus('ready')
          },
          (failure) => {
            if (runRef.current !== run) return
            setError(failure instanceof Error ? failure.message : String(failure))
            setStatus('error')
          },
        )
      }, [sessionId])

      React.useEffect(() => {
        if (!open) return undefined
        load()
        const compute = () => {
          if (anchorRef.current) setGeo(panelGeometry(anchorRef.current))
        }
        compute()
        const onPointer = (event) => {
          const target = event.target
          if (!(target instanceof Node)) return
          if (panelRef.current && panelRef.current.contains(target)) return
          if (anchorRef.current && anchorRef.current.contains(target)) return
          // 面板是 portal 到 body 的；被卸载的旧实例其 ref 已失效，
          // 此时用「是否命中当前文档里的任何面板」兜底，避免旧实例关掉新实例。
          for (const node of document.querySelectorAll('.wb-panel')) {
            if (node.contains(target)) return
          }
          for (const node of document.querySelectorAll('.wb-root')) {
            if (node.contains(target)) return
          }
          setOpenState(false)
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          setOpenState(false)
          setDetail(null)
          const button = anchorRef.current && anchorRef.current.querySelector('button')
          if (button) button.focus()
        }
        window.addEventListener('resize', compute)
        window.addEventListener('scroll', compute, true)
        document.addEventListener('pointerdown', onPointer, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          runRef.current += 1
          window.removeEventListener('resize', compute)
          window.removeEventListener('scroll', compute, true)
          document.removeEventListener('pointerdown', onPointer, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [open, load])

      React.useEffect(() => {
        if (!open) return undefined
        const timer = setTimeout(() => {
          if (searchRef.current) searchRef.current.focus()
        }, 0)
        return () => clearTimeout(timer)
      }, [open])

      /**
       * 写选择并收起面板。id 为空串表示取消选择。
       * 「点已选中的再取消」只是这里的一个调用方，判定在外面做，
       * 免得空串被当成某个工作台的 id 参与比较。
       */
      const applySelection = React.useCallback(async (id) => {
        setBusy(true)
        try {
          const payload = await call('select', { sessionId, id })
          setState(payload)
          setStatus('ready')
          setDetail(null)
          setOpenState(false)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
          setStatus('error')
        } finally {
          setBusy(false)
        }
      }, [sessionId])

      /** 列表行/详情页按钮：点已选中的就取消，否则选中。 */
      const select = React.useCallback(async (id) => {
        const current = state === null ? undefined : state.selectedId
        await applySelection(id === current ? '' : id)
      }, [applySelection, state])

      /** 底部「取消当前工作台」。 */
      const clearSelection = React.useCallback(async () => {
        await applySelection('')
      }, [applySelection])

      const toggleSetting = React.useCallback(async (key, value) => {
        setBusy(true)
        try {
          const payload = await call('settings', { sessionId, settings: { [key]: value } })
          setState(payload)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }, [sessionId])

      /** 供 install('') 读取当前详情里的技能，避免闭包拿到旧值。 */
      const detailSkillsRef = React.useRef(null)
      React.useEffect(() => {
        detailSkillsRef.current = detail !== null && Array.isArray(detail.skills) ? detail.skills : null
      }, [detail])

      /** 安装进行中的技能名，用来禁用对应按钮；空集表示没有在装。 */
      const [installing, setInstalling] = React.useState([])
      /** 最近一次安装结果的提示文案。 */
      const [notice, setNotice] = React.useState(null)

      /**
       * 安装技能。names 为空数组表示「能装的全装」。
       * 装完用返回的 skills 就地刷新详情，不重新拉整个工作台。
       */
      const install = React.useCallback(async (names) => {
        const targets = Array.isArray(names) && names.length > 0
          ? names
          : (detailSkillsRef.current ?? []).filter((skill) => skill.installable).map((skill) => skill.name)
        if (targets.length === 0) return
        setInstalling(targets)
        setNotice(null)
        try {
          const payload = await call('install', { sessionId, names: targets })
          // 服务端已把该工作台的技能状态重新算过，直接用
          if (Array.isArray(payload.skills)) {
            setDetail((current) => (current === null || current.error !== undefined
              ? current
              : { ...current, skills: payload.skills }))
          }
          const parts = []
          if (payload.installed?.length) parts.push(fill(t, 'panel.installDone', payload.installed.length))
          if (payload.skipped?.length) parts.push(fill(t, 'panel.installSkipped', payload.skipped.length))
          if (payload.failed?.length) parts.push(fill(t, 'panel.installFailed', payload.failed.length))
          setNotice({
            text: parts.length > 0 ? parts.join('，') : t('panel.installed'),
            tone: payload.failed?.length ? 'bad' : 'ok',
          })
          // 状态变了，列表里的「本地 N」也要跟着变
          if (typeof payload.total === 'number') setState(payload)
          void load()
        } catch (failure) {
          setNotice({
            text: fill(t, 'panel.error', failure instanceof Error ? failure.message : String(failure)),
            tone: 'bad',
          })
        } finally {
          setInstalling([])
        }
      }, [sessionId, load, t])

      /** 详情按需拉取，列表只带摘要。 */
      const openDetail = React.useCallback(async (id) => {
        setDetailStatus('loading')
        setDetail({ id })
        try {
          const payload = await call(`workbench?id=${encodeURIComponent(id)}`)
          setDetail(payload.workbench)
          setDetailStatus('ready')
        } catch (failure) {
          setDetail({ id, error: failure instanceof Error ? failure.message : String(failure) })
          setDetailStatus('error')
        }
      }, [])

      const selectedName = state?.selected?.name

      const rows = React.useMemo(() => {
        const list = Array.isArray(state?.workbenches) ? state.workbenches : []
        const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
        if (terms.length === 0) return list
        return list.filter((bench) => {
          const haystack = `${bench.name} ${bench.intro} ${bench.greeting}`.toLowerCase()
          return terms.every((term) => haystack.includes(term))
        })
      }, [state, query])

      const panel = open
        ? ReactDOM.createPortal(
            h(
              'div',
              {
                ref: panelRef,
                className: 'wb-panel',
                role: 'dialog',
                'aria-modal': 'false',
                'aria-label': t('panel.title'),
                style: geo === null ? { visibility: 'hidden' } : {
                  left: geo.left, bottom: geo.bottom, width: geo.width, maxHeight: geo.maxHeight,
                },
              },
              h(
                'div',
                { className: 'wb-head' },
                h(
                  'div',
                  { className: 'wb-head-row' },
                  h('span', { className: 'wb-title' }, detail === null ? t('panel.title') : (detail.name || '')),
                  h('span', { className: 'wb-count' }, state === null ? '' : fill(t, 'panel.count', rows.length)),
                ),
                h('span', { className: 'wb-sub' }, detail === null ? t('panel.subtitle') : t('panel.skills')),
                detail === null
                  ? h('input', {
                      ref: searchRef,
                      className: 'wb-search',
                      type: 'search',
                      value: query,
                      placeholder: t('panel.search'),
                      onChange: (event) => setQuery(event.target.value),
                      'aria-label': t('panel.search'),
                    })
                  : null,
              ),
              h('div', { className: 'wb-body' }, detail === null
                ? renderList()
                : renderDetail()),
              renderFooter(),
            ),
            document.body,
          )
        : null

      function renderList() {
        // 首次打开时 status 仍是 'idle'，此时还没发请求，不能显示「没有匹配」。
        if (state === null) {
          if (status === 'error') {
            return h('div', { className: 'wb-state wb-error' }, fill(t, 'panel.error', error),
              h('div', null, h('button', { className: 'wb-retry', type: 'button', onClick: load }, t('panel.retry'))))
          }
          return h('div', { className: 'wb-state' }, t('panel.loading'))
        }
        if (rows.length === 0) return h('div', { className: 'wb-state' }, t('panel.empty'))
        return rows.map((bench) => {
          const selected = bench.id === state?.selectedId
          return h(
            'div',
            { key: bench.id, className: 'wb-row-wrap', style: { display: 'flex', alignItems: 'stretch' } },
            h(
              'button',
              {
                className: 'wb-row',
                type: 'button',
                'data-selected': selected ? 'true' : 'false',
                'aria-pressed': selected,
                disabled: busy,
                onClick: () => { void select(bench.id) },
                title: selected ? t('panel.unpickHint') : t('panel.pickHint'),
              },
              h('span', { className: 'wb-dot', 'aria-hidden': 'true' }),
              h(
                'span',
                { className: 'wb-text' },
                h('span', { className: 'wb-name' }, bench.name,
                  selected ? h('span', { className: 'wb-badge' }, t('panel.current')) : null),
                h('span', { className: 'wb-intro' }, bench.intro),
                h('span', { className: 'wb-meta' },
                  h('span', null, `${bench.skillCount} 技能`),
                  h('span', null, `${bench.localSkillCount} 本地`)),
              ),
            ),
            h('button', {
              className: 'wb-more',
              type: 'button',
              onClick: (event) => { event.stopPropagation(); void openDetail(bench.id) },
              'aria-label': `${t('panel.detail')}：${bench.name}`,
            }, t('panel.detail')),
          )
        })
      }

      function renderDetail() {
        if (detailStatus === 'loading') return h('div', { className: 'wb-state' }, t('panel.loading'))
        if (detail.error) return h('div', { className: 'wb-state wb-error' }, fill(t, 'panel.error', detail.error))
        const bench = detail
        const skills = Array.isArray(bench.skills) ? bench.skills : []
        const plugins = Array.isArray(bench.plugins) ? bench.plugins : []
        const suggestions = Array.isArray(bench.suggestions) ? bench.suggestions : []
        const localCount = skills.filter((skill) => skill.installed === true || skill.local === true).length
        const installable = skills.filter((skill) => skill.installable === true)
        return h(
          'div',
          { className: 'wb-detail' },
          h('p', null, bench.intro),
          h('div', { className: 'wb-actions' },
            h('button', { className: 'wb-link', type: 'button', onClick: () => setDetail(null) }, t('panel.back')),
            h('button', {
              className: 'wb-link',
              type: 'button',
              disabled: busy,
              onClick: () => { void select(bench.id) },
            }, bench.id === state?.selectedId ? t('panel.clear') : t('panel.useThis')),
          ),
          h('div', { className: 'wb-h' }, `${t('panel.skills')} · ${fill(t, 'panel.skillsLocal', localCount, skills.length)}`),
          installable.length > 0
            ? h('div', { className: 'wb-installbar' },
                h('button', {
                  className: 'wb-install',
                  type: 'button',
                  disabled: busy || installing.length > 0,
                  onClick: () => { void install(installable.map((skill) => skill.name)) },
                }, installing.length > 0
                  ? t('panel.installing')
                  : fill(t, 'panel.installAll', installable.length)),
                h('span', { className: 'wb-hint' }, t('panel.installHint')))
            : null,
          notice !== null
            ? h('div', { className: 'wb-notice', 'data-tone': notice.tone }, notice.text)
            : null,
          skills.length === 0
            ? h('p', null, t('panel.noSkill'))
            : h('ul', { className: 'wb-list' }, skills.map((skill) => {
                const isInstalling = installing.includes(skill.name)
                return h('li', {
                  key: skill.name,
                  className: 'wb-skill-row',
                  title: skill.installed
                    ? t('panel.installed')
                    : (skill.installable ? t('panel.installHint') : t('panel.noSource')),
                },
                  h('span', { className: 'wb-code' }, skill.name),
                  h('span', { className: 'wb-skill-title' }, skill.title),
                  skill.installed
                    ? null
                    : (skill.installable
                        ? h('button', {
                            className: 'wb-install',
                            type: 'button',
                            disabled: busy || isInstalling || installing.length > 0,
                            onClick: () => { void install([skill.name]) },
                          }, isInstalling ? t('panel.installing') : t('panel.install'))
                        : h('span', { className: 'wb-badge' }, t('panel.noSource'))))
              })),
          plugins.length > 0
            ? h('div', null,
                h('div', { className: 'wb-h' }, t('panel.plugins')),
                h('ul', { className: 'wb-list' }, plugins.map((plugin) => h('li', { key: plugin.name },
                  h('span', null, plugin.title)))))
            : null,
          suggestions.length > 0
            ? h('div', null,
                h('div', { className: 'wb-h' }, t('panel.suggestions')),
                h('ul', { className: 'wb-list' }, suggestions.slice(0, 8).map((item, index) => h('li', { key: index },
                  h('span', { className: 'wb-task' }, item.text)))))
            : null,
        )
      }

      function renderFooter() {
        if (state === null) return null
        const settings = state.settings ?? {}
        return h(
          'div',
          { className: 'wb-foot' },
          h('div', { className: 'wb-h' }, t('panel.settings')),
          h('label', { className: 'wb-opt' },
            h('input', {
              type: 'checkbox',
              checked: settings.injectSkillRouting !== false,
              disabled: busy,
              onChange: (event) => { void toggleSetting('injectSkillRouting', event.target.checked) },
            }),
            h('span', null, t('panel.optRouting'))),
          h('label', { className: 'wb-opt' },
            h('input', {
              type: 'checkbox',
              checked: settings.injectSuggestions === true,
              disabled: busy,
              onChange: (event) => { void toggleSetting('injectSuggestions', event.target.checked) },
            }),
            h('span', null, t('panel.optSuggestions'))),
          h('div', { className: 'wb-actions' },
            h('button', {
              className: 'wb-link',
              type: 'button',
              disabled: busy || !state.selectedId,
              onClick: () => { void clearSelection() },
            }, t('panel.clear')),
            h('span', { className: 'wb-count', style: { marginLeft: 'auto' } },
              fill(t, 'panel.footer', state.total ?? 0, state.capturedAt || '—')),
          ),
          // 数据来源如实标注：这类插件最需要让人一眼看出内容从哪来
          state.source
            ? h('span', { className: 'wb-count', title: state.source },
                fill(t, 'panel.source', state.source))
            : null,
        )
      }

      return h(
        'div',
        { className: 'wb-root', ref: anchorRef },
        h(
          'button',
          {
            className: 'wb-button',
            type: 'button',
            'data-active': selectedName === undefined ? 'false' : 'true',
            'aria-expanded': open,
            'aria-haspopup': 'dialog',
            title: selectedName === undefined ? t('button.title') : `${t('button.title')}：${selectedName}`,
            // composer 会自己消费点击（聚焦输入框、切换工具栏形态），
            // 在按下阶段就处理并阻止冒泡，保证这次点击只属于这个按钮。
            onPointerDown: (event) => {
              event.preventDefault()
              event.stopPropagation()
              trace('pointerdown', { openBefore: openStore.value })
              setOpenState((value) => !value)
            },
            onClick: (event) => {
              event.preventDefault()
              event.stopPropagation()
              trace('click', { openNow: openStore.value })
            },
          },
          h('span', { 'aria-hidden': 'true', style: { fontSize: 13, lineHeight: 1 } }, '▦'),
          h('span', { className: 'wb-label' }, selectedName ?? t('button.none')),
        ),
        panel,
      )
    }

    /* ------------------------------------------------------------------ *
     * 错误边界
     *
     * 一个抛错的组件会让整个 slot 条目变空白（宿主只在控制台留一行
     * "slot entry crashed"）。这里兜住渲染异常，按钮继续在、面板退回关闭，
     * 用户至少还能再次点击。
     * ------------------------------------------------------------------ */

    class PickerBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false, message: '' }
      }

      static getDerivedStateFromError(error) {
        return { failed: true, message: error instanceof Error ? error.message : String(error) }
      }

      componentDidCatch(error) {
        console.error('[workbench] render failed:', error)
        trace('render:threw', error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
      }

      render() {
        // 出错也必须留一个可点的按钮：直接返回 null 会让整个条目消失，
        // 用户看到的就是「点一下就没了」，且再也点不回来。
        if (this.state.failed) {
          return h(
            'button',
            {
              className: 'wb-button',
              type: 'button',
              title: `工作台面板渲染出错：${this.state.message}`,
              onClick: () => this.setState({ failed: false, message: '' }),
            },
            h('span', { 'aria-hidden': 'true' }, '▦'),
            h('span', { className: 'wb-label' }, '工作台（点此重试）'),
          )
        }
        return this.props.children
      }
    }

    function withBoundary(node) {
      return h(PickerBoundary, null, node)
    }

    /* ------------------------------------------------------------------ *
     * 注册
     * ------------------------------------------------------------------ */

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workbench: dictionaries')
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'workbench'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'workbench: styles')

      const localeService = ctx.get('locale')

      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          { name: 'conversation.input.left', id: 'workbench', order: 6, locale: NS },
          (props) => withBoundary(h(WorkbenchPicker, { ...props, localeService })),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})