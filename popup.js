// ============================================================
// Nichinoken Test Data Extractor v3 — Popup Script
// JSON抽出特化版
// ============================================================

let currentExtractedData = null;

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    bindAllEventListeners();

    // まずストレージを確認して、収集済み・収集中の状態を優先表示
    chrome.storage.local.get('nichinokenCollection', ({ nichinokenCollection }) => {
        if (nichinokenCollection?.status === 'done') {
            // 収集完了済み → 即結果を表示
            chrome.storage.local.remove('nichinokenCollection');
            const finalData = {
                version: "3.0",
                dataType: "fieldAccuracyRateAll",
                extractedAt: new Date().toISOString(),
                combinations: nichinokenCollection.results
            };
            currentExtractedData = finalData;
            showBulkResults(finalData);
            document.getElementById('extractResult').style.display = "block";
            return;
        }

        if (nichinokenCollection?.status === 'collecting') {
            // 収集中 → 進捗を表示（完了したら再度開いてください）
            const total = nichinokenCollection.combinations.length;
            const n = nichinokenCollection.results?.length ?? 0;
            document.getElementById('pageStatus').textContent =
                `⏳ データ取得中... (${n} / ${total}) 完了後にもう一度開いてください`;
            setbadge('取得中', 'badge-info');
            return;
        }

        // 収集状態なし → 通常フロー（コンテンツスクリプトに問い合わせ）
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) return;
            const tab = tabs[0];
            const isFieldPage = tab.url?.includes('correct-answer-rate-by-field-list');
            const msg = isFieldPage
                ? { action: "scrapeAllData", mode: "allCombinations" }
                : { action: "scrapeAllData" };

            if (isFieldPage) {
                document.getElementById('pageStatus').textContent = '⏳ 収集を開始しています...';
            }

            chrome.tabs.sendMessage(tab.id, msg, (response) => {
                if (chrome.runtime.lastError) {
                    document.getElementById('pageStatus').textContent =
                        '⚠ ページを更新（F5）してから再度お試しください。';
                    setbadge('未接続', 'badge-error');
                    return;
                }
                handleScrapeResponse(response);
            });
        });
    });
});

// ============================================================
// スクレイピング結果の処理
// ============================================================

function handleScrapeResponse(response) {
    const pageStatus = document.getElementById('pageStatus');

    // 診断ログ表示
    if (response?.logs?.length > 0) {
        document.getElementById('debugSection').style.display = "block";
        document.getElementById('debugLog').textContent = response.logs.join("\n");
    }

    if (!response?.success || !response.data) {
        pageStatus.textContent = `⚠ ${response?.error ?? "不明なエラー"}`;
        setbadge('エラー', 'badge-error');
        return;
    }

    const data = response.data;

    if (data.dataType === 'collectionStarted') {
        pageStatus.textContent = `⏳ 収集開始しました。完了後にもう一度ポップアップを開いてください。`;
        setbadge('取得中', 'badge-info');
        // ポップアップはページ遷移で閉じるため、次回オープン時にストレージから結果を読む
        return;
    }

    currentExtractedData = data;

    if (data.dataType === 'fieldAccuracyRateAll') {
        showBulkResults(data);
    } else if (data.dataType === 'fieldAccuracyRate') {
        pageStatus.textContent = `✅ 分野別正答率データを取得しました！`;
        setbadge('分野別', 'badge-success');
        
        document.getElementById('lblTestName').textContent  = "分野別正答率";
        document.getElementById('lblExamDate').textContent  = data.searchCondition.bracketsText || "--";
        
        const cond = data.searchCondition;
        const condStr = [cond.subject, cond.grade ? cond.grade+"年" : "", cond.term, cond.testType].filter(Boolean).join(" ");
        document.getElementById('lblSubjects').textContent  = condStr || "--";
        
        document.getElementById('lblSummaryStatus').parentElement.querySelector('.result-label').textContent = "データ件数";
        document.getElementById('lblSummaryStatus').textContent = `✅ ${data.fields.length}行のカテゴリ判定`;
    } else {
        const hasSubjects = data.subjects?.length > 0;
        const hasSummary  = !!data.summary;

        if (hasSubjects && hasSummary) {
            pageStatus.textContent = `✅ テストデータを統合取得しました！`;
            setbadge('統合取得', 'badge-success');
        } else if (hasSubjects) {
            pageStatus.textContent = `✅ 問題別データを取得しました（成績集計なし）`;
            setbadge('問題別のみ', 'badge-info');
        } else if (hasSummary) {
            pageStatus.textContent = `✅ 成績集計データを取得しました`;
            setbadge('集計のみ', 'badge-info');
        }

        document.getElementById('lblTestName').textContent  = data.testName || "--";
        document.getElementById('lblExamDate').textContent  = formatExamDate(data.examDate, data.testDateRaw);
        document.getElementById('lblSubjects').textContent  = hasSubjects
            ? data.subjects.map(s => s.score != null ? `${s.subject}(${s.score})` : s.subject).join('、')
            : "--";
            
        document.getElementById('lblSummaryStatus').parentElement.querySelector('.result-label').textContent = "成績集計";
        document.getElementById('lblSummaryStatus').textContent =
            hasSummary ? `✅ ${data.summary.examType === 'public' ? '公開模試' : '育成テスト'}` : '❌ なし';
    }

    document.getElementById('extractResult').style.display = "block";
}

// ============================================================
// イベントリスナー
// ============================================================

function bindAllEventListeners() {

    // ---- JSONダウンロード ----
    document.getElementById('btnExtractAndDownload').addEventListener('click', () => {
        if (!currentExtractedData) { alert("データがありません。"); return; }
        downloadJson(currentExtractedData, generateFilename(currentExtractedData));
        showJsonPreview(currentExtractedData);
    });

    // ---- ログコピー ----
    document.getElementById('btnCopyLog').addEventListener('click', () => {
        navigator.clipboard.writeText(document.getElementById('debugLog').textContent).then(() => {
            const btn = document.getElementById('btnCopyLog');
            btn.textContent = "✅ コピーしました！";
            setTimeout(() => { btn.textContent = "📋 ログをコピー"; }, 2000);
        });
    });

    // ---- JSONプレビュー: コピー ----
    document.getElementById('btnCopyJson').addEventListener('click', () => {
        navigator.clipboard.writeText(document.getElementById('jsonPreview').textContent).then(() => {
            const btn = document.getElementById('btnCopyJson');
            btn.textContent = "✅ コピー完了";
            setTimeout(() => { btn.textContent = "📋 コピー"; }, 2000);
        });
    });

    // ---- JSONプレビュー: 閉じる ----
    document.getElementById('btnClosePreview').addEventListener('click', () => {
        document.getElementById('previewCard').style.display = "none";
    });
}

// ============================================================
// ヘルパー関数
// ============================================================

function showBulkResults(data) {
    const count = data.combinations.length;
    const totalRows = data.combinations.reduce((s, r) => s + r.fields.length, 0);
    document.getElementById('pageStatus').textContent = `✅ 全組み合わせ取得完了！`;
    setbadge('分野別(全件)', 'badge-success');
    document.getElementById('lblTestName').textContent = "分野別正答率（全組み合わせ）";
    document.getElementById('lblExamDate').textContent = "--";
    document.getElementById('lblSubjects').textContent = `${count}件の条件`;
    document.getElementById('lblSummaryStatus').parentElement.querySelector('.result-label').textContent = "データ件数";
    document.getElementById('lblSummaryStatus').textContent = `✅ ${count}条件 / ${totalRows}行`;
}

function setbadge(text, cls) {
    const el = document.getElementById('pageTypeBadge');
    el.textContent = text;
    el.className = `badge ${cls}`;
}

function formatExamDate(examDate, fallback) {
    if (examDate?.isoDate) {
        const roundStr = examDate.round ? ` 第${examDate.round}回` : '';
        return `${examDate.grade ?? '?'}年生${roundStr} ${examDate.year}年${examDate.month}月${examDate.day}日`;
    }
    return fallback || "--";
}

function generateFilename(data) {
    if (data.dataType === 'fieldAccuracyRateAll') {
        const date = new Date().toISOString().slice(0, 10);
        return `nichinoken_${date}_fields_all.json`;
    }
    if (data.dataType === 'fieldAccuracyRate') {
        const cond = data.searchCondition;
        const nameParts = ["fields", cond.subject, cond.grade ? cond.grade+"y" : "", cond.termCode, cond.testTypeCode]
            .filter(Boolean)
            .join("_")
            .replace(/[\s\/\\:*?"<>|]/g, '_');
        const date = new Date().toISOString().slice(0, 10);
        return `nichinoken_${date}_${nameParts}.json`;
    }
    const date = data.examDate?.isoDate || new Date().toISOString().slice(0, 10);
    const name = (data.testName || 'test').replace(/[\s\/\\:*?"<>|]/g, '_');
    return `nichinoken_${date}_${name}.json`;
}

function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    chrome.downloads.download({ url: objectUrl, filename, saveAs: true }, () => {
        URL.revokeObjectURL(objectUrl);
    });
}

function showJsonPreview(data) {
    document.getElementById('jsonPreview').textContent = JSON.stringify(data, null, 2);
    document.getElementById('previewCard').style.display = "block";
}
