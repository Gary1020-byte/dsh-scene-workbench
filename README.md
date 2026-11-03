# dsh-scene-workbench

> 把 **DeepSeek Harness 的 web UI** 變成「場景工作台」。
> 用 DSH 原生的 Cordis 插件機制，在引擎自己的 UI 上加一層場景——
> **不另造 Electron 外殼**。

本 repo 只做 **DSH 專用** 的那層 UI。
場景記憶、派單／回執、工作流規格那些**引擎中立**的方法論在
[`scene-memory-architecture`](https://github.com/Gary1020-byte/scene-memory-architecture)。

```
方法論 repo（引擎中立）        本 repo（DSH 專用）
  場景記憶規格                    把場景「看見」出來
  派單／回執契約                  ← 只讀，不定義
  路由表規格
  驗收工具（引擎中立）
        ↑ 讀同一批檔案
```

---

## v1 做什麼

在 Harness **右側 sidebar** 多一個「場景」分頁，列出目前工作區裡的場景：

- **場景名**（工作目錄最後一段）
- **工作目錄**（滑鼠停留可看完整路徑）
- **§〇 交接摘要**（從 `場景私有記憶.md` 的「當前交接」小節抽出）

**場景怎麼認？** 一個 session 的工作目錄底下有 `場景私有記憶.md` ⇒ 它就是一個場景。
引擎本來就靠 cwd 注入 `AGENTS.md` 與專屬技能，所以「場景」在引擎裡沒有專門的型別——
它是「工作目錄 ＋ 一個記憶檔」。本插件只是把那個約定**看見**出來。

**狀態：v1 已在實機驗收通過**（分頁看得見、點得開、讀得到真資料）→ 見 [`docs/驗收.md`](docs/驗收.md)。

---

## 安裝

### 一、套件安裝（不要手動動 profile）

```bash
# 透過引擎的 plugin_manager（在 DSH session 裡用 agent 工具呼叫）
plugin_manager install_bundle → target: <本 repo>/bundle
```

回傳 `application: applied` 且 `warnings: []` 才算真的活著。

引擎會自己處理：

- `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 加一列
- `~/.dsh/profiles/web/node_modules/@local/dsh-scene-workbench` → symlink 到本 repo 的 `bundle/`
- profile 的 `cordis.patch.yml` 由引擎合成

### 二、重啟引擎

```bash
systemctl --user restart dsh-web
```

profile 是**啟動時合成**的，安裝後要重啟才會載入新的 bundle。

### 三、驗收

開 web UI → 開右側 sidebar → Start 頁的「工具」清單裡會出現 **場景** → 點它。
或按 `Ctrl/Cmd + Alt + J`。

---

## 目錄

```
bundle/
  package.json        套件 metadata（exports 必須含 "./package.json"）
  index.js            Host 側（v1 是空的；之後做場景設定檔／派單再填）
  client.js           Client 側：右側 sidebar 的「場景」分頁
  cordis.patch.yml    bundle patch（插入一列 plugin row）
  icon.svg            圖示
docs/
  設計.md             為什麼走 DSH 原生、取捨在哪
  slot地圖.md         Cordis slot 地圖與選槽理由
  驗收.md             ★ 實機驗收紀錄與踩過的坑
```

---

## 已知限制

- **面板網格沒有等價插槽**。外殼原本有網格，原生路徑只有 `sidebar.right.pane.tab`
  與 `shell.overlay`（全螢幕覆蓋）。本 repo 選了分頁，3D 總覽要嘛用 overlay 重做。
  理由見 [`docs/設計.md`](docs/設計.md)。
- **Host 側還沒接**。場景設定檔、路由表、派單都還沒接進來。

---

## License

MIT
