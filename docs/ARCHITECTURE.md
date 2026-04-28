# 日能研テストデータ抽出ツール — 技術ドキュメント

> **最終更新**: 2026-04-29  
> **バージョン**: v4.0  
> **対象サイト**: https://mynichinoken.jp

---

## 1. サイト構造マップ

### 1.1 「テストの振り返り」ページ階層

```
テストのふり返り (examination-review-top-n.html)
│
├── 最新テストのふり返り（直近30日分のテスト一覧テーブル）
│   ├── テスト行 (tr)
│   │   ├── テスト名 (td: "全国公開模試(4/25)")
│   │   ├── 科目ボタン (a[href*="exam-type"]) ×4
│   │   │   → exam-type{N}.html?exam_date=YYYYMMDD&exam_knd=P|N&subject=K|M|S|R&exam_tran=SDP
│   │   └── 成績ボタン (a: テキスト"成績")
│   │       → examination-public-trial-results.html (公開模試)
│   │       → training-examination-results.html (育成テスト)
│   └── ...
│
├── 育成テストのふり返りをしよう！
│   → examination-review-list-n.html（過去テスト一覧）
│
├── 全国公開模試のふり返りをしよう！
│   → examination-public-trial-review-list.html
│
└── 講習特別テストのふり返りをしよう！
    → examination-training-special-review-list.html
```

### 1.2 テスト詳細ページ

各科目ボタンからアクセスするページの構造：

```
テスト詳細ページ (exam-type{N}.html)
│
├── 教科タブ (.seigo-tab-item)
│   ├── 国語 (subject=K, active時は .active クラス)
│   ├── 算数 (subject=M)
│   ├── 社会 (subject=S)
│   └── 理科 (subject=R)
│
├── ビュータブ (右側の3タブ)
│   ├── 答案画像 (exam_tran=SDP) → 採点済み答案PDF表示
│   │   セレクタ: .side-tab_viewAnswerImage
│   ├── 正誤一覧 (exam_tran=SDC) → 問題別正誤データ
│   │   セレクタ: .side-tab_viewErrata
│   └── 成績 (exam_tran=RD) → 成績集計
│       セレクタ: .side-tab_viewResults
│
└── サブリンク（ビュータブ下部）
    ├── 》問題 → open-problem.html (Bookendビューア)
    │   ※ Canvas描画、fetch不可
    ├── 》解答 → sample-answer-pdf.html?exam=...
    │   PDFビューアラッパー
    └── 》解説 → answerguide-commentary.html?exam=...
        HTML解説ページ
```

### 1.3 成績ページ

```
成績集計ページ
├── 公開模試成績 (body#ER_G)
│   ├── 集計テーブル (.syukei-typeComprehensive_table-4c)
│   │   4科目/3科目/2科目/各教科の得点・平均点・偏差値
│   ├── 順位テーブル (.syukei_table)
│   │   総合順位・男女別順位
│   └── 偏差値分布表
│
└── 育成テスト成績 (body#ER_A)
    ├── 基本集計 (.syukei-wrap)
    │   共通/応用/合計/平均/評価
    ├── 順位 (.syukei_table 2番目)
    └── 受験種別集計 (.syukei-examinationType-wrap)
        共通/選択/合計/平均/評価
```

---

## 2. URL パラメータリファレンス

### 2.1 共通パラメータ

| パラメータ | 値 | 説明 |
|---|---|---|
| `exam_date` | `YYYYMMDD` | テスト実施日 |
| `exam_knd` | `P` / `N` / `S` | P=公開模試, N=育成テスト, S=講習特別 |
| `subject` | `K` / `M` / `S` / `R` | K=国語, M=算数, S=社会, R=理科 |
| `exam_tran` | `SDP` / `SDC` / `RD` | SDP=答案画像, SDC=正誤一覧, RD=成績 |
| `yesr_val` | `YYYY` | 年度 |
| `tak` | `文字列` | セッショントークン（必須） |

### 2.2 URL構築ルール

科目ボタンのベースURLから、`exam_tran` パラメータを変更するだけで
異なるビュー（答案画像/正誤一覧/成績）にアクセス可能：

```javascript
// ベースURL（答案画像ページ、exam_tran=SDP）
const baseUrl = "https://mynichinoken.jp/myn/student/examination-transition/exam-type1.html?exam_date=20260425&exam_knd=P&subject=K&exam_tran=SDP&tak=xxx";

// 正誤一覧に変更
const sdcUrl = new URL(baseUrl);
sdcUrl.searchParams.set('exam_tran', 'SDC');

// 成績に変更
const rdUrl = new URL(baseUrl);
rdUrl.searchParams.set('exam_tran', 'RD');
```

---

## 3. DOM セレクタリファレンス

### 3.1 テスト一覧ページ（トップ）

| 要素 | セレクタ | 説明 |
|---|---|---|
| 科目ボタン | `a[href*="exam-type"]` | 教科別の詳細ページリンク |
| 成績ボタン | テキスト「成績」の `<a>` | 成績集計ページリンク |
| テスト名 | 各 `<tr>` の最初の `<td>` | テスト名テキスト |

### 3.2 詳細ページ（正誤一覧）

| 要素 | セレクタ | 説明 |
|---|---|---|
| テスト名 | `h1.headingBox-main` | テスト名見出し |
| 日付 | `.date-text` | 実施日テキスト |
| 教科タブ | `.seigo-tab-item` | 教科切り替えタブ |
| アクティブ教科 | `.seigo-tab-item.active a` | 現在表示中の教科 |
| 正誤テーブル | `.seigo-anser-guide_table tbody tr` | 問題別データ行 |
| 得点 | `.point-text` | 教科別得点 |
| 正答サマリー | `.answer-text` | 正誤概要 |
| 正誤一覧タブ | `.side-tab_viewErrata a` | 正誤一覧ページURL |
| 成績タブ | `.side-tab_viewResults a` | 成績ページURL |

### 3.3 成績ページ

| 要素 | セレクタ | 説明 |
|---|---|---|
| 実施日 | `.attention_day` | 実施日情報 |
| 集計セクション | `.syukei-wrap` | 成績集計エリア |
| 公開模試スコア表 | `.syukei-typeComprehensive_table-4c table` | 得点/平均/偏差値 |
| 育成テスト集計表 | `.syukei_table table` | 共通/応用/合計 |
| 受験種別集計 | `.syukei-examinationType-wrap` | 受験種別別 |

### 3.4 分野別正答率ページ

| 要素 | セレクタ | 説明 |
|---|---|---|
| 正答率テーブル | `.CorrectAnswerRate_table tbody` | 分野別データ |
| 科目ラジオ | `input[name="subject_v"]` | 科目フィルタ |
| 学年ラジオ | `input[name="grade_v"]` | 学年フィルタ |
| 期ラジオ | `input[name="term_v"]` | 期フィルタ |
| テスト種別ラジオ | `input[name="test_knds_v"]` | テスト種別フィルタ |

---

## 4. データスキーマ

### 4.1 正誤一覧データ（1教科分）

```json
{
  "testId": "2026-04-25_全国公開模試_国語",
  "testName": "全国公開模試",
  "testDateRaw": "4年生 第2回 2026年4月25日実施",
  "examDate": {
    "grade": 4, "round": 2,
    "year": 2026, "month": 4, "day": 25,
    "isoDate": "2026-04-25"
  },
  "subject": "国語",
  "score": 86,
  "scoreRaw": "86点",
  "answerSummary": "誤答(×)61点 無答(レ)3点",
  "questions": [
    {
      "number": "［一］1",
      "rawUnit": "読み：金品；",
      "category": "読み",
      "subCategory": "金品",
      "result": "○",
      "correctAnswer": "きんぴん",
      "correctRate": 45,
      "incorrectRate": 42,
      "noAnswerRate": 13
    }
  ],
  "extractedAt": "2026-04-28T..."
}
```

### 4.2 成績集計データ（公開模試）

```json
{
  "examType": "public",
  "testName": "全国公開模試成績",
  "attentionDayRaw": "4年生 第2回 2026年4月25日実施",
  "examDate": { "grade": 4, "round": 2, "year": 2026, "month": 4, "day": 25 },
  "basicSummary": [
    { "label": "4科目", "score": 332, "avg": 259.0, "hensa": 58.8 },
    { "label": "国語", "score": 86, "avg": 73.5, "hensa": 54.5 }
  ],
  "rankings": [
    { "label": "4科目", "totalCount": 8748, "myRank": 1624, "genderCount": 4592, "myGenderRank": 761 }
  ]
}
```

### 4.3 成績集計データ（育成テスト）

```json
{
  "examType": "training",
  "basicSummary": [
    { "label": "国語", "kyotsu": 60, "oyo": 26, "total": 86, "avg": 73.5, "eval": 7 }
  ],
  "examTypeSummary": [
    { "label": "国語", "kyotsu": 60, "sentaku": 26, "total": 86, "avg": 73.5, "eval": 7 }
  ]
}
```

### 4.4 パッケージデータ（v4.0）

```json
{
  "version": "4.0",
  "dataType": "testPackage",
  "extractedAt": "2026-04-28T...",
  "testCount": 3,
  "tests": [
    {
      "testName": "全国公開模試(4/25)",
      "examDate": "20260425",
      "examKnd": "P",
      "subjects": [ /* 4.1の形式 × 教科数 */ ],
      "summary": { /* 4.2 or 4.3 の形式 */ }
    }
  ]
}
```

---

## 5. 拡張機能アーキテクチャ

### 5.1 ファイル構成

```
nichinoken-test-analyzer/
├── manifest.json          # Chrome拡張の設定 (Manifest V3)
├── content.js             # ページDOMを読み取るコンテンツスクリプト
├── popup.html             # ポップアップUI
├── popup.js               # ポップアップのロジック
├── popup.css              # ポップアップのスタイル
├── jszip.min.js           # ZIP生成ライブラリ
├── docs/                  # このドキュメント群
│   ├── ARCHITECTURE.md    # 本ファイル
│   └── CHANGELOG.md       # 変更履歴
└── bak/                   # バックアップ
    └── v3.1/              # v3.1のファイル群
```

### 5.2 メッセージフロー

```
fetchTestPackage フロー:
popup.js ── sendMessage(fetchTestPackage) ─→ content.js
                                                  │
         ┌── sendResponse({started}) ────────┘
         │
         │   content.js ── fetch巡回 ─→ chrome.storage.local
         │                              (progress + result)
         │
popup.js ── setIntervalポーリング ─→ chrome.storage.local
         │
         └─→ 結果取得 → ZIP生成 → ダウンロード
```

> **注**: v4.0.1で`sendResponse`の非同期タイムアウト問題を回避するため、
> `fetchTestPackage`は即座に応答し、実際の結果は`chrome.storage.local`経由で渡す方式に変更。

### 5.3 メッセージアクション一覧

| action | 方向 | 説明 | 追加バージョン |
|---|---|---|---|
| `scrapeAllData` | popup→content | 現在ページの全データ抽出 | v3.0 |
| `scrapeAllData` (mode: allCombinations) | popup→content | 分野別正答率の全組み合わせ取得 | v3.1 |
| `downloadBookendImages` | popup→content | Bookendビューアの画像ダウンロード | v3.0 |
| `scanTestList` | popup→content | トップページのテスト一覧解析 | **v4.0** |
| `fetchTestPackage` | popup→content | 選択テストの全データ一括取得 | **v4.0** |

### 5.4 ページ判定ロジック

```javascript
// popup.js のモード判定
if (url.includes('examination-review-top')              → パッケージモード
 || url.includes('examination-review-list')             → パッケージモード
 || url.includes('examination-public-trial-review-list')→ パッケージモード
 || url.includes('examination-training-special-review'))→ パッケージモード
if (url.includes('open-problem/open-answer'))           → Bookendモード
if (url.includes('correct-answer-rate'))                → 分野別正答率モード
else                                                    → 単体抽出モード
```

---

## 6. 制限事項と既知の問題

### 6.1 取得できないデータ

| データ | 理由 | 代替手段 |
|---|---|---|
| 問題用紙 | Bookendビューア（Canvas描画）で保護 | 手動で画像DL機能を使用 |

### 6.2 セッション依存

- すべてのfetchリクエストは `credentials: "include"` でログインセッションのCookieを送信
- セッションが切れると全てのfetchが失敗する
- `tak` パラメータ（セッショントークン）もURL内に含まれる

### 6.3 レート制限

- サーバーへの負荷軽減のため、各fetchリクエスト間に300msの遅延を設定
- 大量のテストを一度に取得する場合は遅延増加を検討

---

## 7. 今後の拡張ポイント

| 機能 | 難易度 | 説明 |
|---|---|---|
| 解答PDFの自動取得 | 中 | sample-answer-pdf.html内のPDF URLを抽出してfetch |
| 解説ページのテキスト抽出 | 中 | answerguide-commentary.htmlのHTML内容を構造化 |
| 過去テスト一覧対応 | 中 | examination-review-list-n.htmlを解析 |
| 答案画像PDFの取得 | 中〜高 | PDF URLのパターン解析が必要 |
| 定期自動取得 | 高 | Chrome Alarms APIで定期実行 |
| データの差分管理 | 高 | 前回取得分との差分検出 |
