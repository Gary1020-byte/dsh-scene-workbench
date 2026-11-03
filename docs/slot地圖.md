# Slot 地圖

> **能選的插槽、它們各自配置了什麼空間、以及本插件為什麼選它。**
> 來源：引擎自帶的 `cordis-plugin-development` 教材 ＋ 已安裝套件的原始碼
> （`@deepseek-ai/dsh-client-ui-*`）。

---

## 一、規則先記住

官方規格有兩條硬規則，決定了「場景工作台」能做到什麼形狀：

| 規則 | 原文（意譯） |
|---|---|
| **不要造版面** | 「選一個**已經分配空間**的插槽」；「不要替換 app root，也不要往 `document.body` 再掛一個應用程式」 |
| **不要讀別人的 DOM** | 「不要讀別人套件的 DOM／樣式表／元件原始碼來推測位置」 |

⇒ **結論：工作台是「長在 Harness 裡的面板」，不是「取代 Harness 的介面」。**
這也正好對上方法論那條紅線：**引擎不需要理解這套方法論**，它只提供插槽。

---

## 二、可用插槽（實測自引擎的 client runner）

### 會話區

```
conversation.header
conversation.header.leading
conversation.session.header
conversation.session.header.actions
conversation.session.header.corner
conversation.session.header.lineage
conversation.session.header.utilities
conversation.session.header.views.actions
conversation.hero.agentPreset
conversation.hero.brand.mark
conversation.hero.options
conversation.hero.workspace
conversation.hero.workspace.directoryFlow
conversation.chat.flow
conversation.chat.node
conversation.chat.turnTail
conversation.chat.message.images
conversation.chat.user.images
conversation.chat.reasoning.body
conversation.chat.commandview
conversation.approval.detail
conversation.input.left
conversation.input.right
conversation.input.dock
conversation.input.overlay
conversation.input.model
conversation.input.model.label
conversation.input.permission
conversation.input.plan
conversation.input.attachments
conversation.input.activity
conversation.composer
conversation.composer.bar
conversation.composer.dock
conversation.trajectory.images
conversation.user.text.node
conversation.view
```

### 右側 sidebar

```
sidebar.right.pane.tab          ← ★ 整個分頁本體
sidebar.right.pane.tab.title    ← 分頁的標題列
sidebar.right.tab.files.actions ← 檔案分頁的動作列
```

### 其他

```
shell.overlay                   ← 全螢幕覆蓋層
session
```

---

## 三、選位對照

| 需求 | 選哪個 | 理由 | 風險 |
|---|---|---|---|
| **場景清單**（v1） | `sidebar.right.pane.tab` | 官方 `sidebar-files` 就是這樣註冊一個新分頁的；已驗證可行 | 低——照抄既有模式 |
| **點場景開會話**（v2） | 同上 + `ctx.uiWorkspace.openSession(id)` | 引擎原生 API | 低 |
| **場景分頁列**（v3） | `conversation.session.header.leading` | 標題列左邊，適合放一排場景頁籤 | 中——要確認它配置的水平空間夠不夠 |
| **場景分頁列**（備選） | `conversation.session.header.utilities` | 標題列右側的工具區 | 中——通常放的是「更多」類的小元件 |
| **3D 總覽**（v5） | `sidebar.right.pane.tab` 的第二個分頁 | 右側本來就是長內容的地方 | 中——3D 效能 |
| **3D 總覽**（備選） | `shell.overlay` | 全螢幕，適合圖譜 | 高——覆蓋層要自己管關閉、焦點、Esc |

> ★ **左邊的大面板網格沒有對應插槽。**
> 方法論 repo 那套 Electron 外殼做的「場景分頁 ＋ 面板網格」，
> 在 Harness 原生裡**沒有等價物**——最接近的是 `shell.overlay`（全螢幕覆蓋）。
> 這是選 DSH 原生路徑要付的代價：**面板網格得自己用 overlay 重做，或放棄網格、改用分頁。**
> 見 [`設計.md`](設計.md) 的取捨。

---

## 四、註冊 API 速查

```js
// 右側分頁：先註冊「分頁型別」，再註冊分頁本體與標題
ctx.effect(() => ctx.sidebarRightTabs.register({
  id: '<bundle id>', kind: '<型別>', priority: 'builtin',
  title: () => t('tab.title'), guide: [],
}), '…')

ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab', key: '<bundle id>', locale: NS,
}, Body)), '…')

ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab.title', key: '<bundle id>',
}, Title)), '…')
```

**分頁元件拿得到的 props**（由 tab 框架給）：

```
useTabInfo  sessionId  useSessions  useStore  actions
start  refresh  setAutoRefresh  toggle  t  renderSlot
```

> ★ **props 裡沒有 `ctx`。**
> 所以要拿 `ctx.remote`／`ctx.uiWorkspace`，得把 ctx 存在 **module 閉包**裡
> （`factory` 只載入一次，`apply(ctx)` 把它填進去），元件從閉包取。
> 別掛 `window` 全域變數——那是全域污染，而且插件卸載時不會清掉。

---

## 五、拿資料的路徑

| 要什麼 | 怎麼拿 | 備註 |
|---|---|---|
| 所有 session | `useSessions((s) => s.list)` | 形狀可能是陣列或 store，`Array.isArray` 先判 |
| 某 session 的 cwd | `useSessions((s) => s.byId[id]?.cwd)` | |
| 列目錄 | `ctx.remote.workspaceFiles.list(sessionId, path, signal)` | `path` 傳 cwd（與 sidebar-files 相同） |
| 讀檔 | `ctx.remote.workspaceFiles.read(sessionId, path, { offset }, signal)` | 回 `RemoteResult`（`.ok` / `.value`） |
| 開會話 | `ctx.uiWorkspace.openSession(id)` | |

> ★ `workspaceFiles` 回的是 **RemoteResult**，不是直接的資料：
> 要判 `.ok`，失敗時 `.error` 是帶穩定 code 的 `RemoteError`。
> 讀檔失敗**不要讓整個清單壞掉**——單一場景讀不到就跳過它。

---

## 六、Client 模組的形狀

```js
window.__ModuleLoader__.load({
  id: '<套件名>',            // ★ 必須等於 package 的 name
  factory(require) {
    const React = require('react')   // React 來自瀏覽器模組表，不要自己裝
    return {
      inject: ['slots'],              // 需要等哪些服務
      apply(ctx) { /* 註冊 */ },
    }
  },
})
```

- **不要有副作用**在 factory 裡；資源（樣式、計時器、監聽器）要在 `apply` 裡
  用 `ctx.effect` / `ctx.on` 註冊，並回傳清理函式
- 可見文字要走 **locale 服務**（`ctx.locale.register(NS, { zh, en })`）
- 容器與控制項**沿用主機主題**（CSS 變數）；只有 artwork 可以用自己的顏色
