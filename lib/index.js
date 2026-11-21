/**
 * 豆包工作台 — Host 半。
 *
 * 复刻豆包「工作台」机制：一个工作台 = 一段场景系统提示词 + 一组被挂载的 skill，
 * 而不是一个新 skill。选中某个工作台后，这段提示词进入该 Session 的下一步系统提示，
 * 并（可选）把一个「路由」小节注入提示词，让模型按工作台自己的规则挑选主 skill。
 *
 * 三处共享同一份状态，任何一处都读不到别的副本：
 *
 *   - `/dsh-workbench/*`  面板使用的 HTTP 通道（选工作台、改设置、读定义）
 *   - `workbench`         模型工具（列出/查看工作台及其技能栈）
 *   - systemPrompt               选中工作台后注入的场景提示词
 *
 * 状态按 SessionId 保存在内存里；Session 是唯一事实来源，插件只做派生，
 * 重开 Session 默认回到「无工作台」。
 *
 * @module dsh-workbench
 */

import { appendFile, cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-workbench'

/** 两个能力都可选：部署里没有提示词服务或 tools 时插件仍然加载。 */
export const inject = []

const HERE = dirname(fileURLToPath(import.meta.url))

/** 排障日志落在数据目录旁，方便直接读。 */
const TRACE_FILE = join(HERE, '..', 'trace.log')

/** 面板与工具共用的 HTTP 前缀。 */
const ROUTE_PREFIX = '/dsh-workbench'

/* ---------------------------------------------------------------------- *
 * 技能源
 *
 * 「安装」= 把本机已存在的技能目录复制进 DSH 的技能目录。不联网、不下载，
 * 所以能装什么完全取决于本机已经有什么。
 *
 * 两个来源：
 *   - DSH 自己的技能目录（装了就是装了）
 *   - 本机其它 AI 客户端的技能目录（用户选了才复制过来）
 * 扫描结果按目录名索引；同名以先扫到的为准。
 * ---------------------------------------------------------------------- */

/** 每个来源：名字、候选路径（相对用户目录）、以及是否算作"已安装"。 */
function skillSources() {
  const home = homedir()
  return [
    {
      id: 'dsh',
      title: 'DSH 技能库',
      installed: true,
      paths: [
        join(home, '.dsh', 'skills'),
        join(process.env.DSH_HOME ?? join(home, '.dsh'), 'skills'),
      ],
    },
    {
      id: 'doubao',
      title: '豆包客户端',
      installed: false,
      paths: [
        join(home, 'AppData', 'Local', 'Doubao', 'User Data', 'Default', '.doubao',
          'agent_mode', 'workspace', '.skills'),
      ],
    },
  ]
}

/** 目标目录：装到这里才算真的"已安装"。 */
function installTarget() {
  const home = homedir()
  return join(process.env.DSH_HOME ?? join(home, '.dsh'), 'skills')
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * 扫一遍所有来源，返回 name -> { source, dir, installed }。
 * 只认含 SKILL.md 的目录，避免把杂物当技能。
 */
async function scanSkillSources() {
  const found = new Map()
  for (const source of skillSources()) {
    for (const root of source.paths) {
      if (!(await isDirectory(root))) continue
      let entries
      try {
        entries = await readdir(root, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const name = entry.name
        if (found.has(name)) continue
        const dir = join(root, name)
        // 必须有 SKILL.md 才算技能
        try {
          const manifest = await readFile(join(dir, 'SKILL.md'), 'utf8')
          if (!manifest.startsWith('---')) continue
        } catch {
          continue
        }
        found.set(name, { source: source.id, title: source.title, dir, installed: source.installed })
      }
    }
  }
  return found
}

/** 注入与面板共用：某个技能当前是否真的装好了。 */
async function installedNames() {
  const names = new Set()
  const target = installTarget()
  if (!(await isDirectory(target))) return names
  try {
    for (const entry of await readdir(target, { withFileTypes: true })) {
      if (entry.isDirectory()) names.add(entry.name)
    }
  } catch {
    /* 读不到就当没有 */
  }
  return names
}

/** 注入到系统提示里的 section 名；order 落在部署人设之后、工具说明之前。 */
const SECTION_ORDER = 450

const DEFAULTS = {
  enabled: true,
  injectSkillRouting: true,
  injectSuggestions: false,
}

/* ---------------------------------------------------------------------- *
 * 数据集
 * ---------------------------------------------------------------------- */

let catalogPromise

/**
 * 读取并缓存工作台数据集。
 *
 * 两个来源合并：
 * - `data/workbenches.json`：从豆包客户端抓的 20 个原始工作台，重抓会整体覆盖；
 * - `data/custom-workbenches.json`：本插件自己维护的工作台（Godot 游戏开发等）。
 *   单独成文件，所以重抓豆包数据不会把它覆盖掉。
 * 自建的排在前面，用户最可能用的先出现。
 */
function loadCatalog() {
  if (catalogPromise === undefined) {
    catalogPromise = (async () => {
      const readOne = async (relative) => {
        try {
          return JSON.parse(await readFile(join(HERE, '..', 'data', relative), 'utf8'))
        } catch {
          return undefined
        }
      }
      const [captured, custom] = await Promise.all([
        readOne('workbenches.json'),
        readOne('custom-workbenches.json'),
      ])

      const customList = Array.isArray(custom?.workbenches) ? custom.workbenches : []
      const capturedList = Array.isArray(captured?.workbenches) ? captured.workbenches : []

      const list = []
      const byId = new Map()
      for (const bench of [...customList, ...capturedList]) {
        if (bench === null || typeof bench !== 'object') continue
        if (typeof bench.id !== 'string' || bench.id === '') continue
        if (byId.has(bench.id)) continue
        // 缺失字段补齐，渲染与面板都假定这些字段存在
        const normalized = {
          custom: false,
          version: '1',
          intro: '',
          greeting: '',
          instruction: '',
          extraInstruction: '',
          plugins: [],
          suggestions: [],
          creators: [],
          skillGroups: [],
          ...bench,
          skills: Array.isArray(bench.skills) ? bench.skills : [],
        }
        list.push(normalized)
        byId.set(normalized.id, normalized)
      }

      const sourceParts = []
      if (typeof custom?.source === 'string' && custom.source !== '') sourceParts.push(custom.source)
      if (typeof captured?.source === 'string' && captured.source !== '') sourceParts.push(captured.source)

      return {
        capturedAt: String(captured?.capturedAt ?? custom?.capturedAt ?? ''),
        source: sourceParts.join('；'),
        list,
        byId,
      }
    })()
  }
  return catalogPromise
}

/* ---------------------------------------------------------------------- *
 * 会话状态
 * ---------------------------------------------------------------------- */

/**
 * 每个 Session 的选择。存在内存里而不是 Session 事件里：工作台选择是
 * 会话级视图状态，不需要在日志里留下一条自定义事件（那会让旧读者拒开 Session）。
 */
const selections = new Map()

function readSelection(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  return selections.get(sessionId)
}

function writeSelection(sessionId, value) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  if (value === undefined || value === null) selections.delete(sessionId)
  else selections.set(sessionId, value)
}

/* ---------------------------------------------------------------------- *
 * 系统提示渲染
 * ---------------------------------------------------------------------- */

/**
 * 把工作台定义渲染成提示词文本。
 *
 * 直接把豆包原文放进去，但去掉对「本站不存在的工作台」的转派措辞：
 * 那些工作台在这里可能已作为另一个工作台存在，指向不存在的目标会误导模型。
 */
/**
 * 技能在注入文本里的附注。
 * 装好的不写；能装但没装的提示用户去面板装；本机根本没源文件的说明只作文档。
 */
/**
 * 最近一次扫描到的技能安装状态。
 *
 * section 的 text 是同步求值的，不能在里面 await 扫盘。所以维护一份缓存：
 * 启动时、面板请求时、安装完成后刷新；provider 只读缓存。
 * 缓存没建立时按数据集里的快照走，不会因为缺状态就丢内容。
 */
let skillStateCache

async function refreshSkillStateCache() {
  const [sources, installed] = await Promise.all([scanSkillSources(), installedNames()])
  const state = new Map()
  for (const [name, found] of sources) {
    state.set(name, installed.has(name) ? 'installed' : 'installable')
  }
  // 装好但扫描源里没有的（例如 DSH 目录里有、但两个来源都没扫到）
  for (const name of installed) state.set(name, 'installed')
  skillStateCache = state
  return state
}

function applySkillState(skills) {
  if (skillStateCache === undefined) return skills
  return skills.map((skill) => {
    const state = skillStateCache.get(skill.name)
    if (state === undefined) return { ...skill, installed: false, installable: false }
    return { ...skill, installed: state === 'installed', installable: state === 'installable', local: state === 'installed' }
  })
}

function skillTail(skill) {
  if (skill.installed === true || skill.local === true) return ''
  if (skill.installable === true) return '（本地未安装，可在工作台面板一键安装）'
  return '（本地未安装，且本机没有该技能的源文件，仅作能力说明）'
}

function renderSection(bench, catalog, settings, liveSkills) {
  // liveSkills 是运行时算出来的技能状态；没有就退回数据集里的快照。
  const skills = Array.isArray(liveSkills) ? liveSkills : bench.skills
  const lines = []
  lines.push(`## 当前工作台：${bench.name}`)
  lines.push('')
  if (bench.intro !== '') {
    lines.push(`工作台定位：${bench.intro}`)
    lines.push('')
  }
  lines.push('你现在位于这个工作台。遵守下面的场景规则；它们描述这个工作台的目标、边界和交付标准。')
  lines.push('')
  lines.push(bench.instruction.trim())
  const extra = typeof bench.extraInstruction === 'string' ? bench.extraInstruction.trim() : ''
  if (extra !== '') {
    lines.push('')
    lines.push(extra)
  }

  if (settings.injectSkillRouting && skills.length > 0) {
    lines.push('')
    lines.push('### 本工作台可用的技能')
    lines.push('')
    lines.push('下面这些技能与当前工作台配套。需要时用技能工具加载；一个任务只选一个主技能，避免多个完整技能重复起稿。')

    const groups = Array.isArray(bench.skillGroups) ? bench.skillGroups : []
    if (groups.length > 0) {
      // 分组展示：技能多的时候平铺成一条长列表没人读得下去。
      const byName = new Map(skills.map((skill) => [skill.name, skill]))
      for (const group of groups) {
        const members = (Array.isArray(group.skills) ? group.skills : [])
          .map((entry) => byName.get(entry.slug ?? entry.name))
          .filter((skill) => skill !== undefined)
        if (members.length === 0) continue
        lines.push('')
        lines.push(`**${group.name}**`)
        lines.push('')
        for (const skill of members) {
          const tail = skillTail(skill)
          const summary = skill.summary !== '' ? skill.summary : firstSentence(skill.description)
          lines.push(`- \`${skill.name}\`｜${skill.title}：${summary}${tail}`)
        }
      }
      // 分组没覆盖到的技能补在末尾，避免漏掉
      const covered = new Set()
      for (const group of groups) {
        for (const entry of Array.isArray(group.skills) ? group.skills : []) {
          covered.add(entry.slug ?? entry.name)
        }
      }
      const rest = skills.filter((skill) => !covered.has(skill.name))
      if (rest.length > 0) {
        lines.push('')
        lines.push('**其他**')
        lines.push('')
        for (const skill of rest) {
          const tail = skillTail(skill)
          const summary = skill.summary !== '' ? skill.summary : firstSentence(skill.description)
          lines.push(`- \`${skill.name}\`｜${skill.title}：${summary}${tail}`)
        }
      }
    } else {
      lines.push('')
      for (const skill of skills) {
        const tail = skillTail(skill)
        const summary = skill.summary !== '' ? skill.summary : firstSentence(skill.description)
        lines.push(`- \`${skill.name}\`｜${skill.title}：${summary}${tail}`)
      }
    }
  }

  if (settings.injectSuggestions && bench.suggestions.length > 0) {
    lines.push('')
    lines.push('### 该工作台的典型任务')
    lines.push('')
    for (const item of bench.suggestions.slice(0, 6)) {
      lines.push(`- ${item.text}`)
    }
  }

  // 自建工作台不展开其他工作台清单：20 个名字会让模型分心，
  // 它需要的是明确自己该做什么、以及什么时候该说「这不归我」。
  if (!bench.custom) {
    const others = catalog.list.filter((item) => item.id !== bench.id && !item.custom).map((item) => item.name)
    if (others.length > 0) {
      lines.push('')
      lines.push(`### 其他可用工作台`)
      lines.push('')
      lines.push(`用户在面板里可以随时切换工作台，当前可切换的有：${others.join('、')}。任务明显不属于本工作台时，提示用户切换而不是硬做。`)
    }
  } else {
    lines.push('')
    lines.push('### 关于工作台切换')
    lines.push('')
    lines.push('用户可以在输入框的工作台面板里切换或取消工作台。任务明显超出「Godot 游戏开发」时（例如写小说、做 PPT、查法律条文），直接说明并建议切到对应工作台，不要硬做。')
  }
  return lines.join('\n')
}

/** 头部一句，给没有短摘要的技能补一条能读的说明。 */
function firstSentence(text) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (value === '') return '（无说明）'
  const cut = value.split(/(?<=[。！？.!?])/)[0]
  return cut.length > 120 ? `${cut.slice(0, 118)}…` : cut
}

/* ---------------------------------------------------------------------- *
 * 存储：设置
 * ---------------------------------------------------------------------- */

function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const bool = (key) => (typeof source[key] === 'boolean' ? source[key] : DEFAULTS[key])
  return {
    enabled: bool('enabled'),
    injectSkillRouting: bool('injectSkillRouting'),
    injectSuggestions: bool('injectSuggestions'),
  }
}

/* ---------------------------------------------------------------------- *
 * 插件入口
 * ---------------------------------------------------------------------- */

export function apply(ctx, config) {
  const log = (message) => {
    try {
      ctx.logger?.info?.(message)
    } catch {
      /* 日志不得影响主流程 */
    }
  }
  const settings = { ...DEFAULTS, ...normalizeSettings(config) }

  /**
   * 某个工作台的技能，带**运行时**安装状态。
   *
   * 数据集里的 local 是抓取当时的快照，装完不会自己变。这里每次都用真实
   * 目录覆盖它，并区分两件事：
   *   installed  —— 现在真的在 DSH 技能目录里
   *   installable—— 本机存在源文件，点一下就能装
   * 两者都假的时候，按钮不该出现（装了也没东西可装）。
   */
  const skillsWithState = async (bench) => {
    const state = await refreshSkillStateCache()
    return bench.skills.map((skill) => {
      const status = state.get(skill.name)
      return {
        ...skill,
        local: status === 'installed',
        installed: status === 'installed',
        installable: status === 'installable',
      }
    })
  }

  /** 一次读取，供面板首屏与工具使用。 */
  const snapshot = async (sessionId) => {
    const catalog = await loadCatalog()
    const chosen = readSelection(sessionId)
    const selected = chosen === undefined ? null : catalog.byId.get(chosen) ?? null
    const selectedSkills = selected === null ? [] : await skillsWithState(selected)
    return {
      source: catalog.source,
      capturedAt: catalog.capturedAt,
      total: catalog.list.length,
      settings,
      sessionId: sessionId ?? null,
      selectedId: selected === null ? null : selected.id,
      selected: selected === null ? null : {
        id: selected.id,
        name: selected.name,
        intro: selected.intro,
        greeting: selected.greeting,
        skillCount: selected.skills.length,
        localSkillCount: selectedSkills.filter((skill) => skill.installed).length,
        installableCount: selectedSkills.filter((skill) => skill.installable).length,
        custom: selected.custom === true,
      },
      workbenches: catalog.list.map((bench) => ({
        id: bench.id,
        name: bench.name,
        intro: bench.intro,
        greeting: bench.greeting,
        version: bench.version,
        skillCount: bench.skills.length,
        pluginCount: bench.plugins.length,
        localSkillCount: bench.skills.filter((skill) => skill.local).length,
        custom: bench.custom === true,
      })),
    }
  }

  /* ---- 系统提示注入 ---- */

  /**
   * 已载入的数据集。section 的 text 是同步求值的，所以这里保存一份解析结果；
   * 未就绪时返回空字符串，下一次组装自然补上。
   */
  let loadedCatalog

  const registerPrompt = () => {
    const systemPrompt = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : undefined
    if (systemPrompt === undefined || typeof systemPrompt.section !== 'function') {
      log('dsh-workbench: 当前部署没有 systemPrompt 服务，工作台不注入提示词')
      return undefined
    }
    return systemPrompt.section({
      name: 'workbench:scene',
      order: SECTION_ORDER,
      // 工作台提示词里可能出现 {{ }} 字样，关掉插值避免被当成变量。
      interpolate: false,
      text: (assembly) => {
        if (!settings.enabled) return ''
        const agent = assembly === undefined || assembly === null ? undefined : assembly.agent
        const sessionId = agent !== undefined && agent !== null && typeof agent.id === 'string' ? agent.id : undefined
        const chosen = readSelection(sessionId)
        if (chosen === undefined) return ''
        const catalog = loadedCatalog
        if (catalog === undefined) return ''
        const bench = catalog.byId.get(chosen)
        if (bench === undefined) return ''
        return renderSection(bench, catalog, settings, applySkillState(bench.skills))
      },
    })
  }

  /* ---- HTTP 通道 ---- */

  const registerRoute = () => {
    const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    if (webServer === undefined || typeof webServer.register !== 'function') {
      log('dsh-workbench: 当前部署没有 webServer，面板通道不可用')
      return undefined
    }
    return webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const action = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')
        const method = req.method ?? 'GET'
        try {
          if (method === 'GET' && action === 'state') {
            const sessionId = url.searchParams.get('sessionId') ?? ''
            sendJson(res, 200, { ok: true, ...(await snapshot(sessionId)) })
            return
          }
          if (method === 'GET' && action === 'workbench') {
            const catalog = await loadCatalog()
            const id = url.searchParams.get('id') ?? ''
            const bench = catalog.byId.get(id)
            if (bench === undefined) {
              sendJson(res, 404, { ok: false, error: `没有这个工作台：${id}` })
              return
            }
            // 详情页要显示可安装状态，所以带上运行时判定结果
            sendJson(res, 200, {
              ok: true,
              workbench: { ...bench, skills: await skillsWithState(bench) },
            })
            return
          }
          if (method === 'GET' && action === 'skills') {
            const catalog = await loadCatalog()
            const id = url.searchParams.get('id') ?? ''
            const bench = catalog.byId.get(id)
            if (bench === undefined) {
              sendJson(res, 404, { ok: false, error: `没有这个工作台：${id}` })
              return
            }
            sendJson(res, 200, { ok: true, skills: await skillsWithState(bench) })
            return
          }
          if (method !== 'POST') {
            sendJson(res, 405, { ok: false, error: '方法不允许' })
            return
          }
          if (!isLoopback(req.socket?.remoteAddress)) {
            sendJson(res, 403, { ok: false, error: '仅允许本机访问' })
            return
          }
          const body = await readJsonBody(req)
          if (action === 'select') {
            const catalog = await loadCatalog()
            const id = typeof body.id === 'string' ? body.id.trim() : ''
            const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
            if (id === '') {
              writeSelection(sessionId, undefined)
              log(`dsh-workbench: 会话 ${sessionId} 清除工作台`)
              sendJson(res, 200, { ok: true, ...(await snapshot(sessionId)) })
              return
            }
            const bench = catalog.byId.get(id)
            if (bench === undefined) {
              sendJson(res, 404, { ok: false, error: `没有这个工作台：${id}` })
              return
            }
            writeSelection(sessionId, id)
            log(`dsh-workbench: 会话 ${sessionId} 切到「${bench.name}」`)
            sendJson(res, 200, { ok: true, ...(await snapshot(sessionId)) })
            return
          }
          if (action === 'settings') {
            const next = normalizeSettings({ ...settings, ...(body.settings ?? {}) })
            settings.enabled = next.enabled
            settings.injectSkillRouting = next.injectSkillRouting
            settings.injectSuggestions = next.injectSuggestions
            sendJson(res, 200, { ok: true, ...(await snapshot(body.sessionId ?? '')) })
            return
          }
          // 客户端排障：把浏览器里发生的事写到本机文件，用于定位「点一下就消失」。
          if (action === 'trace') {
            const line = typeof body.line === 'string' ? body.line : JSON.stringify(body)
            await appendTrace(line)
            sendJson(res, 200, { ok: true })
            return
          }
          if (action === 'trace-read') {
            sendJson(res, 200, { ok: true, path: TRACE_FILE, lines: await readTrace() })
            return
          }
          // 安装技能：把本机已有的技能目录复制进 DSH 技能目录。
          // 只接受扫描得到的技能名，杜绝任意路径复制。
          if (action === 'install') {
            const wanted = Array.isArray(body.names)
              ? body.names.filter((n) => typeof n === 'string')
              : (typeof body.name === 'string' ? [body.name] : [])
            if (wanted.length === 0) {
              sendJson(res, 400, { ok: false, error: '没有指定要安装的技能' })
              return
            }
            const sources = await scanSkillSources()
            const target = installTarget()
            await mkdir(target, { recursive: true })
            const installed = []
            const skipped = []
            const failed = []
            for (const want of wanted) {
              // 名字必须是扫描到的技能，且不能含路径分隔符
              if (want.includes('/') || want.includes('\\') || want.includes('..')) {
                failed.push({ name: want, error: '技能名非法' })
                continue
              }
              const found = sources.get(want)
              if (found === undefined) {
                skipped.push({ name: want, reason: '本机没有这个技能的源文件' })
                continue
              }
              if (found.installed) {
                skipped.push({ name: want, reason: '已经安装' })
                continue
              }
              const dest = join(target, want)
              try {
                // 目标已存在就不覆盖，避免冲掉用户改过的版本
                if (await isDirectory(dest)) {
                  skipped.push({ name: want, reason: '目标已存在' })
                  continue
                }
                await cp(found.dir, dest, { recursive: true, errorOnExist: false, force: false })
                installed.push(want)
                log(`dsh-workbench: 已安装技能 ${want}（来源 ${found.title}）`)
              } catch (error) {
                failed.push({ name: want, error: errorText(error) })
              }
            }
            // 装完把该工作台的技能状态重新算一遍，前端直接用
            const catalog = await loadCatalog()
            const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
            const chosen = readSelection(sessionId)
            const bench = chosen === undefined ? undefined : catalog.byId.get(chosen)
            const skills = bench === undefined ? [] : await skillsWithState(bench)
            sendJson(res, 200, {
              ok: true,
              installed,
              skipped,
              failed,
              skills,
              ...(await snapshot(sessionId)),
            })
            return
          }
          if (action === 'trace-clear') {
            await clearTrace()
            sendJson(res, 200, { ok: true })
            return
          }
          sendJson(res, 404, { ok: false, error: `未知操作：${action}` })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: errorText(error) })
        }
      },
    })
  }

  /* ---- 模型工具 ---- */

  const registerTool = () => {
    const tools = typeof ctx.get === 'function' ? ctx.get('tools') : undefined
    if (tools === undefined || typeof tools.register !== 'function') {
      log('dsh-workbench: 当前部署没有 tools 服务，workbench 工具不可用')
      return undefined
    }
    return tools.register({
      name: 'workbench',
      description:
        '读取本机保存的豆包工作台定义（写作、正式材料、编程开发、创意设计、金融投研、营销、教师等 20 个场景预设）。每个工作台包含一段场景系统提示词与配套技能清单。用户问「豆包某个工作台用了什么规则/挂了哪些技能」时用 list 再 get；不需要它来挑选技能，当前工作台规则已经注入系统提示。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'get', 'current'],
            description: 'list 列出全部工作台；get 读取一个工作台的完整定义（提示词 + 技能栈）；current 返回当前会话选中的工作台。',
          },
          id: { type: 'string', description: 'get 时的工作台 id，来自 list。' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: typeof value?.text === 'string' ? value.text : '' }],
      },
      async execute(args, executionContext) {
        const catalog = await loadCatalog()
        const action = String(args?.action ?? '')
        if (action === 'list') {
          const lines = catalog.list.map((bench) => {
            const local = bench.skills.filter((skill) => skill.local).length
            return `- ${bench.name}（id: ${bench.id}，v${bench.version}）：${bench.skills.length} 个技能，其中本地已安装 ${local} 个。${bench.intro}`
          })
          return { text: `共 ${catalog.list.length} 个工作台\n${lines.join('\n')}` }
        }
        if (action === 'get') {
          const id = String(args?.id ?? '').trim()
          const bench = catalog.byId.get(id)
          if (bench === undefined) return { text: `没有这个工作台：${id}。先用 list 看可用 id。` }
          const skills = bench.skills
            .map((skill) => `- \`${skill.name}\`｜${skill.title}${skill.local ? '' : '（本地未安装）'}：${skill.summary || firstSentence(skill.description)}`)
            .join('\n')
          return {
            text: `# ${bench.name}（id: ${bench.id}，version ${bench.version}）\n\n${bench.intro}\n\n## 场景系统提示词\n\n${bench.instruction.trim()}\n\n## 挂载的技能（${bench.skills.length}）\n\n${skills}\n\n## 插件（${bench.plugins.length}）\n\n${bench.plugins.map((plugin) => `- ${plugin.title}：${plugin.summary}`).join('\n') || '（无）'}`,
          }
        }
        if (action === 'current') {
          const sessionId = sessionIdOf(executionContext)
          const chosen = readSelection(sessionId)
          if (chosen === undefined) return { text: '当前会话没有选择工作台。' }
          const bench = catalog.byId.get(chosen)
          return { text: bench === undefined ? `选中了未知工作台：${chosen}` : `当前工作台：${bench.name}（id: ${bench.id}，v${bench.version}）` }
        }
        return { text: `未知操作：${action}` }
      },
    })
  }

  /* ---- 优雅注册：任一能力晚到也能补上 ---- */

  const later = (services, label, run) => {
    try {
      if (typeof ctx.inject === 'function') {
        ctx.inject(services, () => {
          try {
            const disposer = run()
            if (disposer !== undefined) ctx.effect(() => disposer, label)
          } catch (error) {
            ctx.logger?.error?.(error)
          }
        })
        return
      }
    } catch (error) {
      ctx.logger?.error?.(error)
    }
    try {
      const disposer = run()
      if (disposer !== undefined) ctx.effect(() => disposer, label)
    } catch (error) {
      ctx.logger?.error?.(error)
    }
  }

  // 数据集先热一次，让第一次系统提示组装就能拿到内容。
  void refreshSkillStateCache().catch(() => {})
  void loadCatalog()
    .then((catalog) => {
      loadedCatalog = catalog
      log(`dsh-workbench: 载入 ${catalog.list.length} 个工作台`)
    })
    .catch((error) => ctx.logger?.error?.(error))

  later(['systemPrompt'], 'dsh-workbench: prompt', registerPrompt)
  later(['webServer'], 'dsh-workbench: routes', registerRoute)
  later(['tools'], 'dsh-workbench: tool', registerTool)

  // Session 关闭时清掉选择，避免 id 复用串台。
  ctx.on('session/disposed', (payload) => {
    const id = sessionIdOf(payload)
    if (id !== undefined) selections.delete(id)
  })
}

/* ---------------------------------------------------------------------- *
 * 小工具
 * ---------------------------------------------------------------------- */

/** 从各种「带 sessionId 的载荷」里取 session id。 */
function sessionIdOf(value) {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return undefined
  for (const key of ['sessionId', 'id']) {
    if (typeof value[key] === 'string' && value[key] !== '') return value[key]
  }
  const session = value.session
  if (session !== null && typeof session === 'object' && typeof session.id === 'string') return session.id
  return undefined
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/* ---------------------------------------------------------------------- *
 * 排障日志
 *
 * 客户端面板出问题（点开就消失、某一步没响应）时，浏览器侧没有可读日志。
 * 这里把客户端上报的事件追加到本机 trace.log，只保留最近 500 行。
 * ---------------------------------------------------------------------- */

async function appendTrace(line) {
  const stamp = new Date().toISOString()
  const text = `${stamp}  ${line}\n`
  try {
    await appendFile(TRACE_FILE, text, 'utf8')
  } catch {
    await writeFile(TRACE_FILE, text, 'utf8')
  }
}

async function readTrace() {
  try {
    const text = await readFile(TRACE_FILE, 'utf8')
    return text.split('\n').filter(Boolean).slice(-200)
  } catch {
    return []
  }
}

async function clearTrace() {
  try {
    await writeFile(TRACE_FILE, '', 'utf8')
  } catch {
    /* 没有就没有 */
  }
}

function isLoopback(address) {
  if (typeof address !== 'string') return false
  return address === '::1' || address.startsWith('127.') || address === '::ffff:127.0.0.1'
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(new Error(`请求体不是合法 JSON：${errorText(error)}`))
      }
    })
    req.on('error', reject)
  })
}