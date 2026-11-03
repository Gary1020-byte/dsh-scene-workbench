/**
 * dsh-scene-workbench —— Host 側
 *
 * v1 是純 Client 插件（只用引擎內建的 session 與 workspaceFiles 服務），
 * 所以 Host 側不需要任何能力，apply 是空的。
 *
 * ★ 保留這個檔案是因為 bundle 的 patch 需要一個可載入的 plugin row；
 *   若之後要做「場景設定檔 / 路由表 / 派單」這類 Host 能力，
 *   就在這裡用 `export function apply(ctx, config) {}` 實作，
 *   並在 cordis.patch.yml 的那一列補上 `config: { ... }`。
 */

export function apply () {
  // v1：無 Host 能力
}
