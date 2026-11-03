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
    /** §〇 交接小節的標題前綴（拿來切出交接摘要）。 */
    const HANDOFF = '## §〇'

    /** module 層的 ctx（apply 會填）。元件從這裡拿 remote 與開會話的方法。 */
    let host = null

    const zh = {
      meta: {
        title: '場景工作台',
        description: '把 DeepSeek Harness 的 web UI 變成場景工作台：右側新增「場景」分頁，列出目前工作區裡的場景。',
      },
      tab: {
        title: '場景',
        empty: '這個工作區裡還沒有場景。',
        count: '{n} 個場景',
        scanning: '正在掃描場景…',
      },
      scene: {
        noHandoff: '（沒有 §〇 交接）',
      },
    }

    const en = {
      meta: {
        title: 'Scene Workbench',
        description: 'Turns the DeepSeek Harness web UI into a scene workbench: a right-sidebar tab that lists the scenes in the current workspace.',
      },
      tab: {
        title: 'Scenes',
        empty: 'No scenes in this workspace yet.',
        count: '{n} scenes',
        scanning: 'Scanning scenes…',
      },
      scene: {
        noHandoff: '(no §0 handoff)',
      },
    }

    /* ───────────── 小工具 ───────────── */

    /** 把 sessions 清單形狀（陣列 或 有 getSnapshot 的 store）統一成陣列。 */
    function toList (snapshot) {
      if (Array.isArray(snapshot)) return snapshot
      if (snapshot && typeof snapshot.getSnapshot === 'function') return snapshot.getSnapshot() || []
      return []
    }

    /** 取 §〇 當前交接的前幾行當摘要。 */
    function handoffSummary (text) {
      if (!text) return ''
      const lines = String(text).split('\n')
      const at = lines.findIndex((l) => l.startsWith(HANDOFF))
      if (at < 0) return ''
      const out = []
      for (let i = at + 1; i < lines.length && out.length < 3; i++) {
        const line = lines[i].trim()
        if (!line) continue
        if (line.startsWith('#')) break
        if (line.startsWith('- ') || line.startsWith('|')) out.push(line.replace(/^[-|]\s*/, ''))
      }
      return out.join(' · ')
    }

    /* ───────────── 右側分頁的定義 ───────────── */

    function definition (t) {
      return {
        id: KEY,
        kind: KIND,
        priority: 'builtin',
        title: () => t('tab.title'),
        guide: [],
      }
    }

    /* ───────────── 分頁內容 ───────────── */

    function ScenesBody ({ useTabInfo, useSessions, t }) {
      const { tab } = useTabInfo()
      const signal = tab && tab.signal
      const snapshot = useSessions((sessions) => sessions.list)
      const sessions = toList(snapshot)
      const [scenes, setScenes] = useState([])
      const [phase, setPhase] = useState('scanning')

      const scan = useCallback(async () => {
        if (!host || !signal) return
        const found = []
        for (const s of sessions) {
          if (signal.aborted) return
          const cwd = s && s.cwd
          const id = s && (s.id || s.sessionId)
          if (!cwd || !id) continue
          try {
            const listing = await host.remote.workspaceFiles.list(id, cwd, signal)
            if (!listing.ok) continue
            const names = (listing.value.entries || []).map((e) => (e && e.name) || '')
            if (!names.includes(MARKER)) continue
            let summary = ''
            try {
              const read = await host.remote.workspaceFiles.read(
                id, cwd + '/' + MARKER, { offset: 0 }, signal,
              )
              if (read.ok) summary = handoffSummary(read.value)
            } catch (e) { /* 讀不到就留空，不讓整個清單壞掉 */ }
            found.push({ id, title: s.title || s.name || cwd, cwd, summary })
          } catch (e) { /* 這個 session 讀不到就跳過 */ }
        }
        if (signal.aborted) return
        setScenes(found)
        setPhase('ready')
      }, [sessions, signal])

      useEffect(() => {
        scan()
      }, [scan])

      if (phase === 'scanning') {
        return h('p', { className: 'dsh-sw-muted' }, t('tab.scanning'))
      }
      if (!scenes.length) {
        return h('p', { className: 'dsh-sw-muted' }, t('tab.empty'))
      }

      return h('div', { className: 'dsh-sw-list' },
        h('p', { className: 'dsh-sw-muted' }, t('tab.count', { n: scenes.length })),
        scenes.map((s) => h('div', {
          key: s.id,
          className: 'dsh-sw-card',
          title: s.cwd,
        },
        h('span', { className: 'dsh-sw-title' }, s.title),
        h('span', { className: 'dsh-sw-path' }, s.cwd),
        s.summary
          ? h('span', { className: 'dsh-sw-handoff' }, s.summary)
          : h('span', { className: 'dsh-sw-handoff dsh-sw-muted' }, t('scene.noHandoff')),
        )),
      )
    }

    function ScenesTitle ({ t }) {
      return h('span', null, t('tab.title'))
    }

    /* ───────────── 掛載 ───────────── */

    function apply (ctx) {
      host = ctx

      ctx.inject(['resources', 'sidebarRightTabs'], (scope) => {
        ctx.effect(() => scope.sidebarRightTabs.register(definition(ctx.locale.bind(NS))), 'dsh-scene-workbench: tab definition')
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-scene-workbench: dictionaries')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: KEY,
          locale: NS,
        }, ScenesBody)), 'dsh-scene-workbench: tab body')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: KEY,
        }, ScenesTitle)), 'dsh-scene-workbench: tab title')
      })
    }

    return { inject: ['slots'], apply }
  },
})
