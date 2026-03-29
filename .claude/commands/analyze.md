Analyze a Nichinoken test JSON file and produce a structured weakness/progress report in Japanese.

## How to use
If the user specified a file path as an argument, use that. Otherwise look for the most recently modified `nichinoken_*.json` file in the current directory.

If multiple JSON files are found, analyze all of them together to show trends across tests.

## Analysis to perform

### 1. 基本情報
- テスト名、実施日、学年
- 教科別得点一覧

### 2. 苦手単元ランキング（全教科）
List questions answered incorrectly (`result === "×"`), sorted by `correctRate` descending (problems where the overall correct rate was high but the student got wrong are the most critical).

For each:
- 順位、教科、単元（category / subCategory）、全体正答率、問題番号

### 3. 要注意問題（全体正答率60%以上なのに×）
These represent gaps where the student is behind peers. Highlight clearly.

### 4. 苦手カテゴリ集計
Group incorrect answers by `category`, count them, and rank by frequency.

### 5. 成績集計サマリー（summaryがある場合）
- 偏差値・順位などを表示
- examType に応じて適切なラベルを使う（training=育成テスト, public=公開模試）

### 6. 複数テスト比較（複数ファイルを解析する場合）
- テスト日付順に並べて教科別得点の推移を表示
- 前回×→今回○になった単元を「克服済み」として祝福表示
- 前回から引き続き×の単元を「継続苦手」として警告表示

## Output format
Use Japanese throughout. Use markdown tables for rankings. Keep it actionable — end with a short "次回の学習ポイント" section summarizing the top 3 focus areas.
