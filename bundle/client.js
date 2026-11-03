/**
 * dsh-scene-workbench —— Client 側
 *
 * 目標：把 DeepSeek Harness 的 web UI 變成「場景工作台」。
 * v1：在右側 sidebar 加一個「場景」分頁，列出目前工作區裡的場景。
 *
 * ── 場景怎麼認 ──────────────────────────────────────────────
 * 一個 session 的工作目錄底下有「場景私有記憶.md」⇒ 它就是一個場景。
 * 這是引擎原生的事：場景的 AGENTS.md 與專屬技能本來就靠 cwd 注入，
 * 所以「場景」在引擎裡沒有專門的型別——它是「工作目錄 ＋ 一個記憶檔」。
 * 本插件只是把那個約定 **看見** 出來。
 *
 * ── 為什麼 v1 不用 Host 側 ──────────────────────────────────
 * 場景清單完全由引擎既有的服務算出來（sessions + workspaceFiles），
 * 不需要自訂 Host 能力，也就不需要 `index.js` 做任何事。
 * 之後要接「場景設定檔 / 路由表 / 派單」再把 Host 補上。
 *
 * ── ★ 踩過的坑（照抄會再犯）────────────────────────────────
 * ① 服務要宣告在 **module 的 exports.inject**，它們才會掛在 ctx 上
 *    （`ctx.slots` / `ctx.locale` / `ctx.sidebarRightTabs` / `ctx.remote`）。
 *    `ctx.inject([...], cb)` 是「等某服務就緒」的延遲機制，不是取服務的方法。
 * ② locale 字典是 **扁平 + 點號 key**（`'guide.title'`），引擎不做巢狀走訪。
 * ③ `workspaceFiles.read` 的 `range.offset` 是 **1-based**，傳 0 會整個失敗。
 * ④ `sidebar.right.pane.tab` 是 **keyed seat**：註冊 tab type 不會自動開分頁，
 *    使用者要有辦法把它叫出來（這裡用 guide 條目 ＋ shortcut）。
 * ⑤ 套件的 `exports` 必須開放 `"./package.json"`，否則引擎解析不到 manifest，
 *    會把整個 client 半邊「靜默」跳過。
 *
 * ── ctx 怎麼進到元件裡 ──────────────────────────────────────
 * slot 註冊只給元件 props，不給 ctx。所以把 ctx 存在 **module 閉包**裡
 * （factory 只載入一次），元件從閉包取；不用掛 window 全域變數。
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-scene-workbench',
  factory (require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const NS = 'dsh-scene-workbench'
    const KEY = '@local/dsh-scene-workbench'
    const KIND = 'scenes'
    /** 場景的記憶真源檔名 —— 它的存在就是「這是一個場景」的證據。 */
    const MARKER = '場景私有記憶.md'
    /** §〇 當前交接的標題前綴。 */
    const H0 = '## §〇'
    /** 讀記憶檔時抓的行數（夠看 §〇 的交接摘要就好）。 */
    const READ_LINES = 160

    /** module 層的 ctx（apply 會填）。元件從這裡拿 remote。 */
    let host = null

    // ★ locale 字典是「扁平 + 點號 key」（引擎按整串 key 查）。
    const zh = {
      'meta.title': '場景工作台',
      'meta.description': '把 DeepSeek Harness 的 web UI 變成場景工作台：右側新增「場景」分頁，列出目前工作區裡的場景。',
      'tab.title': '場景',
      'tab.empty': '這個工作區裡還沒有場景。',
      'tab.count': '{n} 個場景',
      'tab.scanning': '正在掃描場景…',
      'tab.failed': '讀不到場景清單（{reason}）。',
      'scene.handoff': '交接：{text}',
      'scene.noHandoff': '（沒有 §〇 交接）',
      'shortcut.label': '開啟場景分頁',
      'shortcut.noSession': '這個工作區沒有可放分頁的場景面板。',
      'guide.title': '場景',
      'guide.description': '把目前工作區裡的場景列在右側分頁。',
    }

    const en = {
      'meta.title': 'Scene Workbench',
      'meta.description': 'Turns the DeepSeek Harness web UI into a scene workbench: a right-sidebar tab that lists the scenes in the current workspace.',
      'tab.title': 'Scenes',
      'tab.empty': 'No scenes in this workspace yet.',
      'tab.count': '{n} scenes',
      'tab.scanning': 'Scanning scenes…',
      'tab.failed': 'Could not read the scene list ({reason}).',
      'scene.handoff': 'Handoff: {text}',
      'scene.noHandoff': '(no §0 handoff)',
      'shortcut.label': 'Open the Scenes tab',
      'shortcut.noSession': 'This workspace has no pane to host the tab.',
      'guide.title': 'Scenes',
      'guide.description': 'Lists the scenes of the current workspace in a right-sidebar tab.',
    }

    /* ───────────── 小工具 ───────────── */

    /** 取路徑最後一段（場景名）。 */
    function baseName (path) {
      const parts = String(path || '').split('/').filter(Boolean)
      return parts.length ? parts[parts.length - 1] : String(path || '')
    }

    /**
     * 從 §〇 交接裡挑一句話當摘要。
     * 優先「### 4) 下一步 / 卡點」，其次「### 1) 上次交接」。
     * §〇 的內容在 h3 子節下面，所以 **只在遇到 h2（'## '）才停**。
     */
    function handoffSummary (text) {
      if (!text) return ''
      const lines = String(text).split('\n')
      const at = lines.findIndex((l) => l.startsWith(H0))
      if (at < 0) return ''

      // §〇 區段 = 從 §〇 到下一個 h2
      const section = []
      for (let i = at + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) break
        section.push(lines[i])
      }

      const pick = (label) => {
        const idx = section.findIndex((l) => l.startsWith('###') && l.includes(label))
        if (idx < 0) return ''
        const out = []
        for (let i = idx + 1; i < section.length; i++) {
          const line = section[i]
          if (/^#{1,3}\s/.test(line)) break
          const t = line.trim()
          if (t.startsWith('- ') || t.startsWith('|')) out.push(t.replace(/^[-|]\s*/, ''))
          if (out.length >= 2) break
        }
        return out.join(' · ')
      }

      return pick('下一步') || pick('卡點') || pick('上次交接') || ''
    }

    /* ───────────── 右側分頁的定義 ───────────── */

    function definition (t) {
      return {
        id: KEY,
        kind: KIND,
        priority: 'builtin',
        title: () => t('tab.title'),
        guide: [{
          id: 'scenes',
          commandId: 'scenes.workbench',
          order: 10,
          title: () => t('guide.title'),
          description: () => t('guide.description'),
        }],
      }
    }

    /* ───────────── 分頁內容 ───────────── */

    function ScenesBody (props) {
      const { useTabInfo, useSessions } = props
      const t = typeof props.t === 'function'
        ? props.t
        : (key, vars) => (host && host.locale ? host.locale.bind(NS)(key, vars) : key)

      // seat（keyed）提供 useTabInfo；session scope 提供 useSessions。
      // 兩者的存在與否在元件生命週期內不變，所以這樣防禦不會破壞 hooks 順序。
      const info = typeof useTabInfo === 'function' ? useTabInfo() : null
      const tab = info && info.tab
      const signal = tab && tab.signal
      const sessions = typeof useSessions === 'function'
        ? useSessions((s) => Object.values((s && s.byId) || {}))
        : []

      const [scenes, setScenes] = useState([])
      const [phase, setPhase] = useState('scanning')
      const [reason, setReason] = useState('')

      const scan = useCallback(async () => {
        const remote = host && host.remote
        if (!remote || !remote.workspaceFiles) {
          setPhase('failed')
          setReason('remote.workspaceFiles 不可用')
          return
        }
        // ★ 同一個場景目錄可能有多條 session（含已歸檔）→ 以 cwd 去重。
        const byCwd = new Map()
        for (const s of sessions) {
          const cwd = s && s.cwd
          if (!cwd) continue
          if (!byCwd.has(cwd)) byCwd.set(cwd, s)
        }

        const found = []
        for (const [cwd, s] of byCwd) {
          if (signal && signal.aborted) return
          const id = s.id || s.sessionId
          try {
            const listing = await remote.workspaceFiles.list(id, cwd, signal)
            if (!listing || !listing.ok) continue
            const names = (listing.value.entries || []).map((e) => (e && e.name) || '')
            if (!names.includes(MARKER)) continue

            let summary = ''
            try {
              // ★ range.offset 是 1-based。
              const read = await remote.workspaceFiles.read(
                id, cwd + '/' + MARKER, { offset: 1, limit: READ_LINES }, signal,
              )
              if (read && read.ok) summary = handoffSummary(read.value && read.value.text)
            } catch (e) { /* 讀不到就留空，不讓整個清單壞掉 */ }

            found.push({ id, name: baseName(cwd), cwd, summary })
          } catch (e) { /* 這個 session 讀不到就跳過 */ }
        }
        if (signal && signal.aborted) return
        found.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
        setScenes(found)
        setPhase('ready')
      }, [sessions, signal])

      useEffect(() => {
        scan()
      }, [scan])

      if (phase === 'scanning') {
        return h('p', { className: 'dsh-sw-muted' }, t('tab.scanning'))
      }
      if (phase === 'failed') {
        return h('p', { className: 'dsh-sw-muted' }, t('tab.failed', { reason }))
      }
      if (!scenes.length) {
        return h('p', { className: 'dsh-sw-muted' }, t('tab.empty'))
      }

      return h('div', { className: 'dsh-sw-list' },
        h('p', { className: 'dsh-sw-muted' }, t('tab.count', { n: scenes.length })),
        scenes.map((s) => h('div', {
          key: s.cwd,
          className: 'dsh-sw-card',
          title: s.cwd,
        },
        h('span', { className: 'dsh-sw-title' }, s.name),
        h('span', { className: 'dsh-sw-path' }, s.cwd),
        s.summary
          ? h('span', { className: 'dsh-sw-handoff' }, t('scene.handoff', { text: s.summary }))
          : h('span', { className: 'dsh-sw-handoff dsh-sw-muted' }, t('scene.noHandoff')),
        )),
      )
    }

    function ScenesTitle (props) {
      const t = typeof props.t === 'function'
        ? props.t
        : (key) => (host && host.locale ? host.locale.bind(NS)(key) : key)
      return h('span', null, t('tab.title'))
    }

    /* ───────────── 掛載 ───────────── */

    function apply (ctx) {
      host = ctx
      const t = ctx.locale.bind(NS)

      ctx.effect(
        () => ctx.sidebarRightTabs.register(definition(t)),
        'dsh-scene-workbench: tab definition',
      )
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'dsh-scene-workbench: dictionaries',
      )
      ctx.effect(
        () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: KEY,
          locale: NS,
        }, ScenesBody)),
        'dsh-scene-workbench: tab body',
      )
      ctx.effect(
        () => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: KEY,
        }, ScenesTitle)),
        'dsh-scene-workbench: tab title',
      )

      // 開啟入口：shortcut → sidebarRight.openTab(KIND)
      // （註冊 tab type 不會自動開分頁；使用者要有辦法把它叫出來。）
      ctx.inject(['shortcuts'], (scope) => {
        scope.effect(() => scope.shortcuts.register({
          id: 'scenes.workbench',
          label: () => t('shortcut.label'),
          aliases: ['場景', 'scenes', 'scene workbench'],
          defaults: {
            'web:macos': { code: 'KeyJ', modifiers: ['primary', 'alt'] },
            'web:windows': { code: 'KeyJ', modifiers: ['primary', 'alt'] },
            'web:linux': { code: 'KeyJ', modifiers: ['primary', 'alt'] },
            'desktop:macos': { code: 'KeyJ', modifiers: ['primary', 'alt'] },
            'desktop:windows': { code: 'KeyJ', modifiers: ['primary', 'alt'] },
            'desktop:linux': { code: 'KeyJ', modifiers: ['primary', 'alt'] },
          },
          regions: ['page', 'editable', 'terminal'],
          modals: [],
          resolve: () => ({
            status: 'handled',
            run: () => {
              try {
                ctx.sidebarRight.openTab(KIND, {})
              } catch (e) {
                /* 沒有可放分頁的面板就靜默跳過 */
              }
            },
          }),
        }), 'dsh-scene-workbench: shortcut')
      })
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles'],
      apply,
    }
  },
})
