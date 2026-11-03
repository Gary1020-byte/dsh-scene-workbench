# dsh-scene-workbench

> **把 DeepSeek Harness 的 web UI 變成「場景工作台」。**
>
> 不另做 Electron 外殼——用 Harness 自己的 Cordis 插件機制，
> 在它原生 UI 上加一層場景。

---

## 這是什麼

Harness（`dsh`）的引擎本身已經具備「場景」需要的一切：

| 場景需要 | Harness 怎麼提供 |
|---|---|
| 每個場景一個工作目錄 | `dsh-working-directory`（session 的 cwd） |
| 場景的憲法（`AGENTS.md`） | 按 cwd 的 `.git` 根自動注入 |
| 場景的專屬技能 | 按 cwd 的 `.git` 根自動發現 `.dsh/skills/` |
| 場景的常駐會話 | 一條 session，標題＝場景名 |

**所以「場景」在引擎裡沒有專門的型別**——它是「工作目錄 ＋ 一個記憶檔」。
本插件做的第一件事，就是把那個約定**看見**出來：右側 sidebar 多一個「場景」分頁。

```jsonc
// 怎麼認一個場景：工作目錄底下有這張記憶真源檔
場景私有記憶.md
```

---

## v1 做什麼

右側 sidebar 新增「場景」分頁：

- 列出目前工作區裡的**所有場景**（依記憶真源檔判定）
- 每張卡顯示：場景名 / 工作目錄 / **§〇 交接摘要**（下一個會話開起來第一眼要看到的東西）

**v1 不用 Host 側**（`index.js` 是空的）：場景清單完全由引擎既有的
`sessions` ＋ `workspaceFiles` 服務算出來，不需要自訂能力。

---

## 安裝

本套件是一個 **Cordis bundle**，要透過 Harness 的 `plugin_manager` 裝進 profile
（**不要**手改 profile 的 `package.json`／`cordis.patch.yml`，**不要**在 profile 目錄跑 pnpm）。

1. 取得本 repo
2. 讓 Harness 裡的 agent 執行：

```
plugin_manager  action: install_bundle
                target: <本 repo 的 bundle 目錄的絕對路徑>
```

3. 確認：`plugin_manager list_bundles` 看到它、`list_plugins` 看到
   `dsh-scene-workbench` 這一行是 enabled
4. **重載頁面**（或重啟引擎），右側 sidebar 出現「場景」分頁

> ★ 官方流程是 `install_bundle`（它會做套件安裝與 bundle 選擇）。
> 用 shell 自己去動 profile 會破壞它的狀態機。

---

## 開發

```
bundle/                 ← 可被 install_bundle 裝的那一份
  package.json          套件清單（dsh.bundle.patch ＋ dsh.client）
  cordis.patch.yml      Loader patch：在 profile 裡插一行
  index.js              Host 側（v1 留空，之後接場景設定檔／路由表／派單）
  client.js             Client 側（slot 註冊 → 右側分頁）
  locale/{zh,en}.json   文案（meta.title / meta.description 給 Plugin Manager 顯示）
  icon.svg              圖示（原創，currentColor，跟主題走）
docs/                   ← 設計與 slot 選位說明
scripts/                ← 開發用的小工具
```

**改完要做的驗證**

```bash
node --check bundle/client.js && node --check bundle/index.js
python3 -c "import json;[json.load(open(p)) for p in ['bundle/package.json','bundle/locale/zh.json','bundle/locale/en.json']]"
```

---

## 路線圖

| 版本 | 做什麼 | 用到什麼 |
|---|---|---|
| **v1** | 右側「場景」分頁：列出場景 ＋ §〇 摘要 | 純 Client（sessions ＋ workspaceFiles） |
| v2 | 點場景直接開那條會話 | `ctx.uiWorkspace.openSession` |
| v3 | 場景分頁列（常駐在會話標題列附近） | slot `conversation.session.header.leading` |
| v4 | 場景設定檔（面板、路由表、派單入口） | Host 側 `index.js` ＋ 共享層檔案 |
| v5 | 3D 總覽（場景圖譜） | slot `sidebar.right.pane.tab` 或 `shell.overlay` |

> ★ **slot 只能選「已經分配了空間」的插槽**，不能自己造一個版面
> （官方規格明講：「不要替換 app root，也不要往 `document.body` 再掛一個應用程式」）。
> 可用的 slot 清單見 [`docs/slot地圖.md`](docs/slot地圖.md)。

---

## 跟方法論 repo 的關係

本 repo 是**執行端**，不碰方法論。

- 方法論（引擎中立）：場景記憶規格、派單／回執契約、路由表、驗收工具
- 本 repo（DSH 專用）：把那些東西**呈現**在 Harness 的 UI 上

兩邊的分界很清楚：**規格在檔案裡，本 repo 只讀檔案、不定義規則。**

---

## 授權

MIT
