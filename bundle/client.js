/**
 * dsh-scene-workbench —— Client 側
 *
 * 兩個分頁：
 *   ① 「場景」    列出目前工作區裡的場景（清單）
 *   ② 「主控端」  3D 記憶神經元總覽——把場景之間的傳遞機制畫出來
 *
 * ── 場景怎麼認 ──────────────────────────────────────────────
 * 一個 session 的工作目錄底下有「場景私有記憶.md」⇒ 它就是一個場景。
 * 這是引擎原生的事：場景的 AGENTS.md 與專屬技能本來就靠 cwd 注入，
 * 所以「場景」在引擎裡沒有專門的型別——它是「工作目錄 ＋ 一個記憶檔」。
 * 本插件只是把那個約定 **看見** 出來。
 *
 * ── 為什麼 v1 不用 Host 側 ──────────────────────────────────
 * 場景清單與 3D 總覽完全由引擎既有的服務算出來（sessions + workspaceFiles），
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
 * ⑥ 讀檔可以跨出 workspace，**列目錄不行**。所以 3D 總覽走「讀索引檔」
 *    而不是「列目錄」——索引檔（索引.json / 記憶地圖.json）已經把結構寫好了。
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
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'dsh-scene-workbench'
    const KEY = '@local/dsh-scene-workbench'
    const KIND = 'scenes'
    const NEURON_KIND = 'neuron'
    const NEURON_KEY = '@local/dsh-scene-workbench/neuron'
    /** 場景的記憶真源檔名 —— 它的存在就是「這是一個場景」的證據。 */
    const MARKER = '場景私有記憶.md'
    /** §〇 當前交接的標題前綴。 */
    const H0 = '## §〇'
    /** 讀記憶檔時抓的行數（夠看 §〇 的交接摘要就好）。 */
    const READ_LINES = 200

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
      'neuron.title': '記憶神經元',
      'neuron.sub': '3D 總覽 · 拖拽旋轉 · 滾輪縮放 · 點節點看詳情 · 只讀，不改任何檔案',
      'neuron.loading': '正在讀共享層…',
      'neuron.failed': '讀不到共享層（{reason}）。',
      'neuron.empty': '這個工作區底下沒有共享層（_共享記憶/索引.json）。',
      'neuron.stats': '{scenes} 場景 · {docs} 共享文件 · {links} 條傳遞',
      'neuron.hint': '拖曳旋轉 · 滾輪縮放 · 點節點',
      'neuron.kind.scene': '場景',
      'neuron.kind.retired': '已退役場景',
      'neuron.kind.memory': '私有記憶',
      'neuron.kind.doc': '共享文件',
      'neuron.out': '收到 {n} 次派單／回執',
      'neuron.in': '發出 {n} 次派單／回執',
      'neuron.noTransfer': '沒有跨場景傳遞記錄',
      'neuron.path': '路徑',
      'neuron.transfer': '傳遞記錄',
      'neuron.from': '來自 {name}',
      'neuron.to': '派給 {name}',
      'shortcut.label': '開啟場景分頁',
      'shortcut.noSession': '這個工作區沒有可放分頁的場景面板。',
      'shortcut.neuronLabel': '開啟記憶神經元總覽',
      'guide.title': '場景',
      'guide.description': '把目前工作區裡的場景列在右側分頁。',
      'guide.neuronTitle': '記憶神經元',
      'guide.neuronDescription': '3D 總覽：場景之間的派單與回執怎麼流動。',
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
      'neuron.title': 'Memory neurons',
      'neuron.sub': '3D overview · drag to rotate · wheel to zoom · click a node · read-only',
      'neuron.loading': 'Reading the shared layer…',
      'neuron.failed': 'Could not read the shared layer ({reason}).',
      'neuron.empty': 'No shared layer (_共享記憶/索引.json) under this workspace.',
      'neuron.stats': '{scenes} scenes · {docs} docs · {links} transfers',
      'neuron.hint': 'drag to rotate · wheel to zoom · click a node',
      'neuron.kind.scene': 'Scene',
      'neuron.kind.retired': 'Retired scene',
      'neuron.kind.memory': 'Private memory',
      'neuron.kind.doc': 'Shared doc',
      'neuron.out': '{n} dispatches received',
      'neuron.in': '{n} dispatches sent',
      'neuron.noTransfer': 'No cross-scene transfers',
      'neuron.path': 'Path',
      'neuron.transfer': 'Transfers',
      'neuron.from': 'from {name}',
      'neuron.to': 'to {name}',
      'shortcut.label': 'Open the Scenes tab',
      'shortcut.noSession': 'This workspace has no pane to host the tab.',
      'shortcut.neuronLabel': 'Open the memory-neuron overview',
      'guide.title': 'Scenes',
      'guide.description': 'Lists the scenes of the current workspace in a right-sidebar tab.',
      'guide.neuronTitle': 'Memory neurons',
      'guide.neuronDescription': 'A 3D overview of how dispatches and receipts flow between scenes.',
    }

    /* ═══════════════════ 小工具 ═══════════════════ */

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

    /* ═══════════════════ 3D 記憶神經元 ═══════════════════ */

    const NODE_COLOR = {
      scene: '#7fe3ff',
      retired: '#5f6a80',
      memory: '#dfe7ff',
      doc: '#c9d4e6',
    }
    const EDGE_COLOR = {
      派單: '#ffcf6b',
      回執: '#3ddc84',
      呼叫: '#8fb4ff',
      報到: '#b79bff',
      交接: '#2dd4bf',
      其他: '#8f9bb3',
    }

    /** 把通知標籤分類（派單／回執／呼叫／報到／交接／其他）。 */
    function transferKind (tag) {
      const t = String(tag || '')
      if (/派單|派单/.test(t)) return '派單'
      if (/回執|回执/.test(t)) return '回執'
      if (/報到|报到/.test(t)) return '報到'
      if (/呼叫/.test(t)) return '呼叫'
      if (/交接|契約|契约/.test(t)) return '交接'
      return '其他'
    }

    /**
     * 從通知標籤找出發起場景的名。
     * ★ 標籤的第一段通常是 `<發起方>場景<動作>`（例：`命令場景派单·请回执`），
     *   但也有 `<發起方>·<動作>` 與「派單 · 來自 X 場景」這種自由格式。
     *   所以：① 取第一段 → 去掉動作尾綴 → 先當場景名比對；
     *         ② 名稱帶「場景」尾綴但不是已知名時，去掉尾綴再比一次；
     *         ③ 還是不中就全文找最長的已知名。
     */
    function sourceScene (tag, known) {
      if (!tag) return null
      const knownSet = new Set(known)
      const first = String(tag).split(/[·:：]/)[0].trim()
      const stripped = first
        .replace(/(全場景報到|全場景报到|派單|派单|回執|回执|呼叫|報到|报到)$/, '')
        .trim()
      const cands = [stripped]
      if (stripped.endsWith('場景')) cands.push(stripped.slice(0, -2))
      for (const c of cands) if (c && knownSet.has(c)) return c
      let best = null
      for (const n of known) {
        if (String(tag).includes(n) && (!best || n.length > best.length)) best = n
      }
      return best
    }

    /**
     * 從共享層的索引檔建出圖。
     * ★ 只讀索引檔（跨 workspace 的「讀」是允許的，「列目錄」才被限制）。
     */
    async function gatherNeuron (remote, sessionId, cwd, signal) {
      const readText = async (path, limit) => {
        const r = await remote.workspaceFiles.read(sessionId, path, { offset: 1, limit }, signal)
        return r && r.ok ? (r.value && r.value.text) || '' : null
      }
      const readJson = async (path) => {
        const t = await readText(path, 400)
        if (t === null) return null
        try { return JSON.parse(t) } catch (e) { return null }
      }

      // ① 找共享層根目錄：從 cwd 往上試（場景 cwd 的上一層就是場景根）
      const candidates = []
      const push = (p) => { if (p && !candidates.includes(p)) candidates.push(p) }
      push(cwd)
      push(cwd.replace(/\/[^/]+$/, ''))
      push(cwd.replace(/\/[^/]+\/[^/]+$/, ''))

      let root = null
      let index = null
      for (const c of candidates) {
        const j = await readJson(c + '/_共享記憶/索引.json')
        if (j && Array.isArray(j.areas)) { root = c; index = j; break }
      }
      if (!root) return { ok: false, reason: 'no-shared-layer' }

      // ② 記憶地圖（場景 → 私有記憶）
      const map = await readJson(root + '/_共享記憶/記憶地圖.json')
      const mapBy = new Map()
      if (map && Array.isArray(map.areas)) {
        for (const a of map.areas) if (a && a.panel) mapBy.set(a.panel, a)
      }

      // ③ 跨場景通知（傳遞機制的實據）
      const log = (await readText(root + '/_共享記憶/_跨場景通知.md', 2500)) || ''

      // ── 建節點 ──
      const nodes = []
      const edges = []
      const nodeByName = new Map()

      const areas = index.areas.filter((a) => a && a.name)
      for (const a of areas) {
        const node = {
          id: 'scene:' + a.id,
          kind: 'scene',
          label: a.name,
          path: a.memory || '',
          areaId: a.id,
          panel: a.panel,
        }
        nodes.push(node)
        nodeByName.set(a.name, node)

        const mp = mapBy.get(a.panel)
        const priv = (mp && mp.privateMemory && mp.privateMemory[0]) ||
          ((a.memory || '').replace(/^場景\//, '') + '/' + MARKER)
        const memNode = {
          id: 'memory:' + a.id,
          kind: 'memory',
          label: '記憶·' + a.name,
          path: (a.memory || '') + '/' + MARKER,
        }
        nodes.push(memNode)
        edges.push({ a: node.id, b: memNode.id, kind: 'own', label: '私有記憶' })

        if (a.file) {
          const docNode = {
            id: 'doc:' + a.id,
            kind: 'doc',
            label: 'area·' + a.name,
            path: '_共享記憶/' + a.file,
          }
          nodes.push(docNode)
          edges.push({ a: node.id, b: docNode.id, kind: 'area', label: '共享層 area' })
        }
      }

      // ── 傳遞邊（派單／回執）──
      // ① 先掃一遍：收集「在通知裡出現過但已不在索引裡」的場景名（＝已退役的）。
      //    ★ 必須先收集再解析發起方——否則像舊的命令場景（標籤寫「命令場景」）
      //    會因為不在索引裡而整批算成「無發起方」，它的派單全部消失。
      const logLines = log.split('\n')
      const retiredNames = []
      for (const line of logLines) {
        const m = /^- \[[^\]]+\] →\s*([^：:]+)[：:]/.exec(line)
        if (!m) continue
        const name = m[1].trim()
        if (!name || nodeByName.has(name)) continue
        if (!retiredNames.includes(name)) retiredNames.push(name)
      }
      for (const name of retiredNames) {
        // 已退役但有歷史的場景——留成暗色節點，因為「它曾經是路由者」
        // 本身就是機制的一部分。
        const node = { id: 'retired:' + name, kind: 'retired', label: name, path: '' }
        nodes.push(node)
        nodeByName.set(name, node)
      }

      // ② 再解析每一條通知
      const known = areas.map((a) => a.name).concat(retiredNames)
      const transfers = []
      for (const line of logLines) {
        const m = /^- \[([^\]]+)\] →\s*([^：:]+)[：:]\s*(.*)$/.exec(line)
        if (!m) continue
        const ts = m[1]
        const target = m[2].trim()
        const body = m[3]
        const tagM = /【([^】]+)】/.exec(body)
        const tag = tagM ? tagM[1] : ''
        const from = tag ? sourceScene(tag, known) : null
        const kind = transferKind(tag || body)
        transfers.push({ ts, from, to: target, kind, tag, body: body.slice(0, 400) })
      }
      for (const tr of transfers) {
        const to = nodeByName.get(tr.to)
        if (!to) continue
        if (tr.from && tr.from !== tr.to) {
          const from = nodeByName.get(tr.from)
          if (from) edges.push({ a: from.id, b: to.id, kind: 'x:' + tr.kind, label: tr.kind })
        }
      }

      return { ok: true, root, nodes, edges, transfers }
    }

    /* ── 3D 力導向版面 ── */
    // ★ 用「加速度 + 阻尼」，不是直接改座標：直接改會在幾十步內把所有節點
    //   收縮到同一點。結束後再正規化到固定半徑，版面就不會忽大忽小。
    const GRAPH_R = 4.2
    const K_REP = 22
    const K_SPRING = 0.05
    const K_CENTER = 0.010
    const DAMP = 0.86

    function layout (nodes, edges, steps) {
      const N = nodes.length
      if (!N) return
      const sceneNodes = nodes.filter((n) => n.kind === 'scene' || n.kind === 'retired')
      nodes.forEach((n, i) => {
        const si = sceneNodes.indexOf(n)
        if (si >= 0) {
          const a = (si / Math.max(1, sceneNodes.length)) * Math.PI * 2
          n.x = Math.cos(a) * 3.0; n.y = Math.sin(a) * 2.0; n.z = Math.sin(a * 2) * 2.0
        } else {
          const owner = edges.find((e) => e.b === n.id && e.kind === 'own')
          const ownerNode = owner && nodes.find((x) => x.id === owner.a)
          n.x = (ownerNode ? ownerNode.x : 0) + (i % 3 - 1) * 0.5
          n.y = (ownerNode ? ownerNode.y : 0) + (i % 5 - 2) * 0.35
          n.z = (ownerNode ? ownerNode.z : 0) + 0.4
        }
      })
      const idx = new Map(nodes.map((n, i) => [n.id, i]))
      const links = edges
        .filter((e) => e.kind.startsWith('x:') || e.kind === 'own')
        .map((e) => ({ i: idx.get(e.a), j: idx.get(e.b), w: e.kind === 'own' ? 0.35 : 1 }))
        .filter((l) => l.i !== undefined && l.j !== undefined)

      const total = steps || 260
      const vel = nodes.map(() => ({ x: 0, y: 0, z: 0 }))
      for (let s = 0; s < total; s++) {
        const alpha = Math.max(0.03, 1 - s / total)
        for (const v of vel) { v.x = 0; v.y = 0; v.z = 0 }
        // 斥力
        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            const a = nodes[i]; const b = nodes[j]
            let dx = a.x - b.x; let dy = a.y - b.y; let dz = a.z - b.z
            let d2 = dx * dx + dy * dy + dz * dz
            if (d2 < 0.04) { dx = (i - j) * 0.02; dy = 0.02; dz = 0.02; d2 = 0.0012 }
            const d = Math.sqrt(d2)
            let f = (K_REP * alpha) / d2
            if (f > 2.5) f = 2.5
            const ux = (dx / d) * f; const uy = (dy / d) * f; const uz = (dz / d) * f
            vel[i].x += ux; vel[i].y += uy; vel[i].z += uz
            vel[j].x -= ux; vel[j].y -= uy; vel[j].z -= uz
          }
        }
        // 彈簧
        for (const l of links) {
          const a = nodes[l.i]; const b = nodes[l.j]
          const dx = b.x - a.x; const dy = b.y - a.y; const dz = b.z - a.z
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-3
          const rest = l.w === 1 ? 3.4 : 1.7
          const f = K_SPRING * alpha * (d - rest)
          const ux = (dx / d) * f; const uy = (dy / d) * f; const uz = (dz / d) * f
          vel[l.i].x += ux; vel[l.i].y += uy; vel[l.i].z += uz
          vel[l.j].x -= ux; vel[l.j].y -= uy; vel[l.j].z -= uz
        }
        // 向心 + 積分
        for (let i = 0; i < N; i++) {
          const n = nodes[i]; const v = vel[i]
          v.x -= n.x * K_CENTER * alpha
          v.y -= n.y * K_CENTER * alpha
          v.z -= n.z * K_CENTER * alpha
          n.x += v.x * DAMP
          n.y += v.y * DAMP
          n.z += v.z * DAMP
        }
      }
      // 正規化到固定半徑
      let maxR = 0
      for (const n of nodes) {
        const r = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z)
        if (r > maxR) maxR = r
      }
      if (maxR > 0.001) {
        const k = GRAPH_R / maxR
        for (const n of nodes) { n.x *= k; n.y *= k; n.z *= k }
      }
    }

    /** 3D → 2D 投影（含透視）。 */
    function project (p, ry, rx, zoom, cx, cy) {
      const cosY = Math.cos(ry); const sinY = Math.sin(ry)
      const x1 = p.x * cosY + p.z * sinY
      const z1 = -p.x * sinY + p.z * cosY
      const cosX = Math.cos(rx); const sinX = Math.sin(rx)
      const y1 = p.y * cosX - z1 * sinX
      const z2 = p.y * sinX + z1 * cosX
      const persp = 3.2 / (3.2 + z2)
      return { x: cx + x1 * persp * zoom, y: cy + y1 * persp * zoom, d: persp, z: z2 }
    }

    /* ═══════════════════ 分頁定義 ═══════════════════ */

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

    function neuronDefinition (t) {
      return {
        id: NEURON_KEY,
        kind: NEURON_KIND,
        priority: 'builtin',
        title: () => t('neuron.title'),
        guide: [{
          id: 'neuron',
          commandId: 'neuron.workbench',
          order: 20,
          title: () => t('guide.neuronTitle'),
          description: () => t('guide.neuronDescription'),
        }],
      }
    }

    /* ═══════════════════ 分頁一：場景清單 ═══════════════════ */

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

    /* ═══════════════════ 分頁二：3D 記憶神經元 ═══════════════════ */

    function NeuronBody (props) {
      const { useTabInfo, useSessions, sessionId } = props
      const t = typeof props.t === 'function'
        ? props.t
        : (key, vars) => (host && host.locale ? host.locale.bind(NS)(key, vars) : key)

      const info = typeof useTabInfo === 'function' ? useTabInfo() : null
      const tab = info && info.tab
      const signal = tab && tab.signal
      const cwd = typeof useSessions === 'function'
        ? useSessions((s) => {
          const byId = s && s.byId
          const row = byId && sessionId ? byId[sessionId] : undefined
          return row && row.cwd
        })
        : undefined

      const canvasRef = useRef(null)
      const wrapRef = useRef(null)
      const [state, setState] = useState({ phase: 'loading' })
      const [selected, setSelected] = useState(null)
      const [query, setQuery] = useState('')
      const viewRef = useRef({ ry: -0.5, rx: 0.25, zoom: 1, auto: true, drag: null })

      // ① 取資料
      useEffect(() => {
        let alive = true
        const remote = host && host.remote
        if (!remote || !remote.workspaceFiles) {
          setState({ phase: 'failed', reason: 'remote.workspaceFiles 不可用' }); return
        }
        if (!cwd) { setState({ phase: 'failed', reason: 'no-cwd' }); return }
        gatherNeuron(remote, sessionId, cwd, signal).then((res) => {
          if (!alive) return
          if (!res.ok) { setState({ phase: 'failed', reason: res.reason }); return }
          const nodes = res.nodes.map((n) => Object.assign({}, n))
          layout(nodes, res.edges, 280)
          setState({ phase: 'ready', nodes, edges: res.edges, transfers: res.transfers, root: res.root })
        }).catch((e) => {
          if (alive) setState({ phase: 'failed', reason: String((e && e.message) || e) })
        })
        return () => { alive = false }
      }, [cwd, sessionId, signal])

      // ② 畫
      useEffect(() => {
        if (state.phase !== 'ready') return
        const cv = canvasRef.current
        const wrap = wrapRef.current
        if (!cv || !wrap) return
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const resize = () => {
          cv.width = Math.max(1, Math.floor(wrap.clientWidth * dpr))
          cv.height = Math.max(1, Math.floor(wrap.clientHeight * dpr))
          cv.style.width = wrap.clientWidth + 'px'
          cv.style.height = wrap.clientHeight + 'px'
        }
        resize()
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
        if (ro) ro.observe(wrap)

        const g = cv.getContext('2d')
        let timer = 0
        let stopped = false
        let last = 0
        const view = viewRef.current

        // ★ 用 setTimeout 驅動，不要只靠 requestAnimationFrame：
        //   頁面在背景時 rAF 會被暫停（visibilityState=hidden），
        //   只靠 rAF 會讓畫面整個空白。而且第一幀必須同步畫出來。
        const draw = (t2) => {
          const dt = Math.min(0.05, (t2 - last) / 1000 || 0)
          last = t2
          if (view.auto) view.ry += dt * 0.18
          const W = cv.width; const H = cv.height
          const cx = W / 2; const cy = H / 2
          // ★ 投影因子：把半徑 GRAPH_R 的圖剛好放滿畫面短邊的一半。
          const factor = (Math.min(W, H) / (2 * GRAPH_R * 1.18)) * view.zoom
          g.clearRect(0, 0, W, H)

          const q = query.trim().toLowerCase()
          const nodes = state.nodes
          const byId = new Map(nodes.map((n) => [n.id, n]))
          const match = (n) => !q || String(n.label).toLowerCase().includes(q)
          const dim = (n) => q && !match(n)

          // 邊
          for (const e of state.edges) {
            const a = byId.get(e.a); const b = byId.get(e.b)
            if (!a || !b) continue
            if (q && !match(a) && !match(b)) continue
            const pa = project(a, view.ry, view.rx, factor, cx, cy)
            const pb = project(b, view.ry, view.rx, factor, cx, cy)
            const xf = e.kind.startsWith('x:') ? e.kind.slice(2) : null
            g.strokeStyle = xf ? (EDGE_COLOR[xf] || EDGE_COLOR['其他']) : '#39435c'
            g.globalAlpha = dim(a) && dim(b) ? 0.08 : (xf ? 0.55 : 0.3)
            g.lineWidth = (xf ? 1.6 : 1) * dpr
            g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pb.x, pb.y); g.stroke()
          }
          g.globalAlpha = 1

          // 節點
          const labels = []
          for (const n of nodes) {
            const p = project(n, view.ry, view.rx, factor, cx, cy)
            const r = (n.kind === 'scene' ? 9 : n.kind === 'retired' ? 6 : 4.5) * dpr
            g.fillStyle = NODE_COLOR[n.kind] || '#8f9bb3'
            g.globalAlpha = dim(n) ? 0.15 : 1
            g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill()
            if (selected && selected.id === n.id) {
              g.strokeStyle = '#ffffff'; g.lineWidth = 2 * dpr; g.stroke()
            }
            labels.push({ n, p, r })
          }
          g.globalAlpha = 1

          // 標籤（畫在最上層）。★ 底下先描一圈深色，否則在彩色連線上會看不見。
          g.textAlign = 'center'
          g.textBaseline = 'alphabetic'
          for (const { n, p, r } of labels) {
            if (dim(n)) continue
            if (n.kind === 'memory' || n.kind === 'doc') continue
            const ty = p.y - r - 5 * dpr
            g.font = '600 ' + (12 * dpr) + 'px system-ui, -apple-system, sans-serif'
            g.lineWidth = 3 * dpr
            g.strokeStyle = 'rgba(8,12,22,0.92)'
            g.strokeText(n.label, p.x, ty)
            g.fillStyle = n.kind === 'retired' ? 'rgba(190,200,216,0.92)' : 'rgba(236,242,252,0.98)'
            g.fillText(n.label, p.x, ty)
          }
        }
        const loop = () => {
          if (stopped) return
          draw(performance.now())
          timer = setTimeout(loop, 33)
        }
        // 先同步畫一幀（保證看得到），再開始迴圈
        draw(performance.now())
        timer = setTimeout(loop, 33)

        // 互動
        const onDown = (ev) => {
          view.drag = { x: ev.clientX, y: ev.clientY, ry: view.ry, rx: view.rx, moved: false }
          view.auto = false
        }
        const onMove = (ev) => {
          const d = view.drag
          if (!d) return
          const dx = ev.clientX - d.x; const dy = ev.clientY - d.y
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true
          view.ry = d.ry + dx * 0.008
          view.rx = Math.max(-1.4, Math.min(1.4, d.rx + dy * 0.008))
        }
        const onUp = (ev) => {
          const d = view.drag
          view.drag = null
          if (d && !d.moved) {
            const rect = cv.getBoundingClientRect()
            const mx = (ev.clientX - rect.left) * dpr
            const my = (ev.clientY - rect.top) * dpr
            const cx = cv.width / 2; const cy = cv.height / 2
            const factor = (Math.min(cv.width, cv.height) / (2 * GRAPH_R * 1.18)) * view.zoom
            let hit = null
            let best = 1e9
            for (const n of state.nodes) {
              const p = project(n, view.ry, view.rx, factor, cx, cy)
              const dd = (p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my)
              const rr = (n.kind === 'scene' ? 14 : 9) * dpr
              if (dd < rr * rr && dd < best) { best = dd; hit = n }
            }
            setSelected(hit)
          }
        }
        const onWheel = (ev) => {
          ev.preventDefault()
          view.zoom = Math.max(0.4, Math.min(4, view.zoom * (ev.deltaY > 0 ? 0.92 : 1.08)))
        }
        cv.addEventListener('mousedown', onDown)
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        cv.addEventListener('wheel', onWheel, { passive: false })

        return () => {
          stopped = true
          clearTimeout(timer)
          if (ro) ro.disconnect()
          cv.removeEventListener('mousedown', onDown)
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          cv.removeEventListener('wheel', onWheel)
        }
      }, [state, query, selected])

      if (state.phase === 'loading') return h('p', { className: 'dsh-sw-muted' }, t('neuron.loading'))
      if (state.phase === 'failed') {
        return h('p', { className: 'dsh-sw-muted' },
          state.reason === 'no-shared-layer' ? t('neuron.empty') : t('neuron.failed', { reason: state.reason }))
      }

      const sceneCount = state.nodes.filter((n) => n.kind === 'scene' || n.kind === 'retired').length
      const docCount = state.nodes.filter((n) => n.kind === 'doc').length
      const sel = selected
      const selTransfers = sel && (sel.kind === 'scene' || sel.kind === 'retired')
        ? state.transfers.filter((tr) => tr.to === sel.label || tr.from === sel.label)
        : []

      return h('div', { className: 'dsh-nr' },
        h('div', { className: 'dsh-nr-wrap', ref: wrapRef },
          h('canvas', { className: 'dsh-nr-cv', ref: canvasRef }),
          h('div', { className: 'dsh-nr-hud' },
            h('input', {
              className: 'dsh-nr-search', type: 'search', value: query,
              placeholder: '搜場景…',
              onChange: (e) => setQuery(e.target.value),
            }),
            h('span', { className: 'dsh-nr-stat' },
              t('neuron.stats', { scenes: sceneCount, docs: docCount, links: state.transfers.length })),
            h('span', { className: 'dsh-nr-hint' }, t('neuron.hint')),
            h('button', {
              className: 'dsh-nr-btn', type: 'button',
              onClick: () => { viewRef.current.auto = !viewRef.current.auto },
            }, viewRef.current.auto ? '⟳ 自轉：開' : '⟳ 自轉：關'),
            h('button', {
              className: 'dsh-nr-btn', type: 'button',
              onClick: () => {
                viewRef.current.ry = -0.5; viewRef.current.rx = 0.25; viewRef.current.zoom = 1
              },
            }, '⤾ 復位'),
          ),
        ),
        h('div', { className: 'dsh-nr-legend' },
          [['scene', 'neuron.kind.scene'], ['retired', 'neuron.kind.retired'],
            ['memory', 'neuron.kind.memory'], ['doc', 'neuron.kind.doc']]
            .map(([k, label]) => h('span', { className: 'dsh-nr-lg', key: k },
              h('i', { className: 'dsh-nr-dot', style: { background: NODE_COLOR[k] } }),
              t(label))),
        ),
        sel
          ? h('div', { className: 'dsh-nr-detail' },
            h('div', { className: 'dsh-nr-detail-title' }, sel.label),
            h('div', { className: 'dsh-nr-detail-kind' }, t('neuron.kind.' + sel.kind)),
            sel.path ? h('div', { className: 'dsh-nr-detail-path' },
              h('b', null, t('neuron.path') + '：'), sel.path) : null,
            (sel.kind === 'scene' || sel.kind === 'retired')
              ? h('div', { className: 'dsh-nr-detail-line' },
                t('neuron.in', { n: selTransfers.filter((x) => x.from === sel.label).length }),
                ' · ',
                t('neuron.out', { n: selTransfers.filter((x) => x.to === sel.label).length }))
              : null,
            selTransfers.length
              ? h('ul', { className: 'dsh-nr-detail-list' },
                selTransfers.slice(0, 14).map((tr, i) => h('li', { key: i },
                  h('span', { className: 'dsh-nr-tr-time' }, tr.ts),
                  h('span', { className: 'dsh-nr-tr-kind' }, tr.kind),
                  h('span', { className: 'dsh-nr-tr-text' },
                    tr.from ? t('neuron.from', { name: tr.from }) + ' → ' : '→ ',
                    t('neuron.to', { name: tr.to })),
                )))
              : h('div', { className: 'dsh-nr-detail-line dsh-sw-muted' }, t('neuron.noTransfer')),
          )
          : null,
      )
    }

    function NeuronTitle (props) {
      const t = typeof props.t === 'function'
        ? props.t
        : (key) => (host && host.locale ? host.locale.bind(NS)(key) : key)
      return h('span', null, t('neuron.title'))
    }

/* ═══════════════════ 樣式（插件自帶，不依賴外部 CSS）═══════════════════ */

    const STYLE_ID = 'dsh-scene-workbench-style'
    function installStyles () {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID)) return
      const el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = [
        '.dsh-sw-list{display:flex;flex-direction:column;gap:8px;padding:10px 12px;font-size:13px;line-height:1.55}',
        '.dsh-sw-muted{color:var(--muted-foreground,#8f9bb3);margin:0}',
        '.dsh-sw-card{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px solid var(--border,rgba(255,255,255,.09));border-radius:8px;background:rgba(255,255,255,.02)}',
        '.dsh-sw-title{font-weight:600}',
        '.dsh-sw-path{font-size:11px;color:var(--muted-foreground,#8f9bb3);word-break:break-all}',
        '.dsh-sw-handoff{font-size:12px;color:var(--foreground,#e8eefa);opacity:.9}',
        '.dsh-nr{display:flex;flex-direction:column;height:100%;min-height:420px}',
        '.dsh-nr-wrap{position:relative;flex:1;min-height:340px;background:radial-gradient(circle at 50% 45%,rgba(60,90,140,.18),transparent 62%)}',
        '.dsh-nr-cv{display:block;width:100%;height:100%;cursor:grab}',
        '.dsh-nr-cv:active{cursor:grabbing}',
        '.dsh-nr-hud{position:absolute;left:8px;top:8px;right:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11px}',
        '.dsh-nr-search{background:rgba(0,0,0,.35);border:1px solid var(--border,rgba(255,255,255,.12));border-radius:6px;color:inherit;padding:3px 7px;font-size:11px;min-width:110px}',
        '.dsh-nr-stat,.dsh-nr-hint{color:var(--muted-foreground,#8f9bb3);font-size:11px}',
        '.dsh-nr-btn{background:rgba(0,0,0,.35);border:1px solid var(--border,rgba(255,255,255,.12));border-radius:6px;color:inherit;padding:3px 7px;font-size:11px;cursor:pointer}',
        '.dsh-nr-btn:hover{border-color:var(--accent,#7fe3ff)}',
        '.dsh-nr-legend{display:flex;flex-wrap:wrap;gap:10px;padding:6px 12px;font-size:11px;color:var(--muted-foreground,#8f9bb3)}',
        '.dsh-nr-lg{display:inline-flex;align-items:center;gap:4px}',
        '.dsh-nr-dot{width:8px;height:8px;border-radius:50%;display:inline-block}',
        '.dsh-nr-detail{border-top:1px solid var(--border,rgba(255,255,255,.09));padding:8px 12px;font-size:12px;max-height:230px;overflow:auto}',
        '.dsh-nr-detail-title{font-weight:600;font-size:13px}',
        '.dsh-nr-detail-kind{font-size:11px;color:var(--muted-foreground,#8f9bb3)}',
        '.dsh-nr-detail-path{font-size:11px;opacity:.75;word-break:break-all;margin-top:2px}',
        '.dsh-nr-detail-line{font-size:11px;margin-top:3px}',
        '.dsh-nr-detail-list{list-style:none;margin:5px 0 0;padding:0;display:flex;flex-direction:column;gap:3px}',
        '.dsh-nr-detail-list li{display:flex;gap:6px;align-items:baseline;font-size:11px}',
        '.dsh-nr-tr-time{color:var(--muted-foreground,#8f9bb3);font-variant-numeric:tabular-nums;white-space:nowrap}',
        '.dsh-nr-tr-kind{flex:0 0 auto;padding:0 4px;border-radius:4px;background:rgba(255,255,255,.08);font-size:10px}',
        '.dsh-nr-tr-text{opacity:.85}',
      ].join('\n')
      document.head.appendChild(el)
    }

    /* ═══════════════════ 掛載 ═══════════════════ */

    function apply (ctx) {
      host = ctx
      installStyles()
      const t = ctx.locale.bind(NS)

      ctx.effect(
        () => ctx.sidebarRightTabs.register(definition(t)),
        'dsh-scene-workbench: tab definition',
      )
      ctx.effect(
        () => ctx.sidebarRightTabs.register(neuronDefinition(t)),
        'dsh-scene-workbench: neuron tab definition',
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
        () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: NEURON_KEY,
          locale: NS,
        }, NeuronBody)),
        'dsh-scene-workbench: neuron tab body',
      )
      ctx.effect(
        () => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: KEY,
        }, ScenesTitle)),
        'dsh-scene-workbench: tab title',
      )
      ctx.effect(
        () => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: NEURON_KEY,
        }, NeuronTitle)),
        'dsh-scene-workbench: neuron tab title',
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

        scope.effect(() => scope.shortcuts.register({
          id: 'neuron.workbench',
          label: () => t('shortcut.neuronLabel'),
          aliases: ['記憶神經元', 'neurons', 'neuron', '主控端'],
          defaults: {
            'web:macos': { code: 'KeyN', modifiers: ['primary', 'alt'] },
            'web:windows': { code: 'KeyN', modifiers: ['primary', 'alt'] },
            'web:linux': { code: 'KeyN', modifiers: ['primary', 'alt'] },
            'desktop:macos': { code: 'KeyN', modifiers: ['primary', 'alt'] },
            'desktop:windows': { code: 'KeyN', modifiers: ['primary', 'alt'] },
            'desktop:linux': { code: 'KeyN', modifiers: ['primary', 'alt'] },
          },
          regions: ['page', 'editable', 'terminal'],
          modals: [],
          resolve: () => ({
            status: 'handled',
            run: () => {
              try {
                ctx.sidebarRight.openTab(NEURON_KIND, {})
              } catch (e) {
                /* 沒有可放分頁的面板就靜默跳過 */
              }
            },
          }),
        }), 'dsh-scene-workbench: neuron shortcut')
      })
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles'],
      apply,
    }
  },
})
