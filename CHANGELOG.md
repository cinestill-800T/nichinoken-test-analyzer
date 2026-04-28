# Changelog

## v4.1 (2026-04-29)

### 追加
- **解説テキスト取得**: 各教科の解説ページ（`answerguide-commentary.html`）からテキスト版・HTML版の両方を自動取得してZIPに格納
- **解答PDFリンク取得**: 各教科の解答PDFページURLを抽出してJSON保存
- **過去テスト一覧対応**: `examination-review-list-n.html` 等の過去テスト一覧ページでもパッケージモードが起動するように

### 修正
- **ダウンロードが実行されない問題**: `sendResponse`の非同期タイムアウトで結果が返らない問題を`chrome.storage.local`ポーリング方式に変更
- **ダウンロードファイル保存失敗**: `saveAs:true`でポップアップが閉じる問題を`saveAs:false`（デフォルトダウンロードフォルダ）に変更、`revokeObjectURL`の遅延実行
- **ファイル名の連番問題**: ファイル名に時刻（`YYYYMMDD_HHMM`）を含めて一意性を確保

---

## v4.0 (2026-04-29)

### 追加
- **パッケージ一括取得機能**: 「テストの振り返り」トップページで拡張機能を開くと、テスト一覧を自動検出。チェックボックスで選択し、正誤一覧（全教科）＋成績集計を一括取得してZIPパッケージまたは統合JSONでダウンロード可能に
- **デュアルモードUI**: ページ種別を自動判定し、トップページではパッケージモード、詳細ページでは既存の単体抽出モードを表示
- **プログレスバー**: パッケージ取得中のリアルタイム進捗表示（shimmerアニメーション付き）
- **JSZipバンドル**: ZIPパッケージ生成のためのライブラリ同梱
- **技術ドキュメント**: `docs/ARCHITECTURE.md` にサイト構造・DOM構造・データスキーマ等を記録

### 内部変更
- `content.js`: `scanTestList`, `fetchTestPackage` メッセージハンドラ追加
- `content.js`: `parseTestListFromTopPage()`, `fetchTestPackageFlow()`, `buildUrlWithExamTran()` 関数追加
- `popup.html`: パッケージモード用UIセクション追加
- `popup.js`: `activatePackageMode()`, `executePackageFetch()`, `downloadAsZip()` 等追加
- `popup.css`: チェックボックス/ラジオボタン/プログレスバーのスタイル追加

---

## v3.1 (2026-03-30)

### 追加
- **分野別正答率 — 全組み合わせ自動取得**: 分野別正答率ページでポップアップを開くと、科目・学年・期・テスト種別の有効な全組み合わせを自動的にPOSTリクエストで取得・集約するようになった
  - 取得中はプログレス (`⏳ 1 / 16 件取得中...`) をリアルタイム表示
  - データなし・セッション切れなどは診断ログに記録してスキップ
  - 出力JSONの `dataType` は `fieldAccuracyRateAll`、`combinations` 配列に各条件の結果を格納

---

## v3.0 (初期リリース)

### 追加
- 育成テスト・公開模試の問題別回答データ抽出 (`dataType: examData`)
- 分野別正答率（選択中の1条件）の抽出 (`dataType: fieldAccuracyRate`)
- 問題別データと成績集計の統合取得
- タイムアウト付き `fetch` ラッパー
- JSONダウンロード・プレビュー機能
- 診断ログ表示
- Bookendビューア画像ダウンロード
