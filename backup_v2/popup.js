// ============================================================
// 状態管理
// ============================================================
let currentScrapedDataArray = null;  // 問題別回答結果
let currentSummaryData      = null;  // 成績集計（育成/公開 共通）
let activeSubjectFilter     = "all";
let dateFilterFrom          = null;
let dateFilterTo            = null;

// ============================================================
// 初期化・イベント設定
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    await updateAllViews();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        const tabId = tabs[0].id;

// ---- STEP 1: 成績集計ページを先に判定 ----
        chrome.tabs.sendMessage(tabId, { action: "scrapeSummaryData" }, async (summaryResponse) => {
            const connErr = chrome.runtime.lastError;

            // コンテンツスクリプト未注入（拡張機能再読み込み後にページ更新が必要）
            if (connErr) {
                document.getElementById('pageStatus').textContent =
                    '⚠ ページを更新（F5）してから再度お試しください。拡張機能の再読み込み後はページ更新が必要です。';
                return;
            }

            if (summaryResponse?.success && summaryResponse.data) {
                await handleSummaryPageDetected(summaryResponse.data);
                return;
            }

            // 成績集計ページではない → 問題別回答結果ページを判定
            chrome.tabs.sendMessage(tabId, { action: "scrapeTestData" }, async (response) => {
                if (chrome.runtime.lastError) {
                    document.getElementById('pageStatus').textContent =
                        '⚠ ページを更新（F5）してから再度お試しください。';
                    return;
                }
                handleTestPageResponse(response);
            });
        });
    });

    bindAllEventListeners();
});

// ============================================================
// ページ検出ハンドラ
// ============================================================

async function handleSummaryPageDetected(data) {
    currentSummaryData = data;

    const typeLabel = data.examType === 'public' ? '全国公開模試' : '学習力育成テスト';
    document.getElementById('pageStatus').textContent = `✅ ${typeLabel}の成績集計ページを検出しました`;
    document.getElementById('lblSummaryExamType').textContent = typeLabel;
    document.getElementById('lblSummaryTestName').textContent = data.testName;
    document.getElementById('lblSummaryExamDate').textContent = formatExamDate(data.examDate, data.attentionDayRaw);
    document.getElementById('summaryResult').style.display = "block";

    // 重複チェック
    const { summaries = {} } = await chrome.storage.local.get("summaries");
    if (summaries[data.summaryId]) {
        document.getElementById('duplicateWarningSummary').style.display = "block";
    }

    await updateSummaryView();
}

function handleTestPageResponse(response) {
    const pageStatus = document.getElementById('pageStatus');

    // 診断ログ表示
    if (response?.logs?.length > 0) {
        document.getElementById('debugSection').style.display = "block";
        document.getElementById('debugLog').textContent = response.logs.join("\n");
    }

    if (chrome.runtime.lastError || !response?.success || !response.data?.length) {
        const errMsg = chrome.runtime.lastError?.message ?? (response?.error ?? "不明なエラー");
        pageStatus.textContent = `⚠ テスト結果を取得できませんでした: ${errMsg}`;
        return;
    }

    currentScrapedDataArray = response.data;
    const firstData     = currentScrapedDataArray[0];
    const subjList      = currentScrapedDataArray.map(d => d.subject).join("、");
    const scoreList     = currentScrapedDataArray.map(d => `${d.subject}: ${d.score ?? "-"}`).join(" / ");

    pageStatus.textContent = `✅ ${currentScrapedDataArray.length}教科分のテスト結果を検出しました！`;
    document.getElementById('lblTestName').textContent   = firstData.testName;
    document.getElementById('lblSubject').textContent    = subjList;
    document.getElementById('lblExamDate').textContent   = formatExamDate(firstData.examDate, firstData.testDateRaw);
    document.getElementById('lblScore').textContent      = scoreList;
    document.getElementById('scrapeResult').style.display = "block";
    document.getElementById('btnImport').textContent = `${currentScrapedDataArray.length}教科分をまとめて取り込んで保存`;

    // 重複チェック（非同期）
    chrome.storage.local.get("tests", ({ tests = {} }) => {
        const dups = currentScrapedDataArray.filter(d => tests[d.testId]);
        if (dups.length > 0) {
            const warningEl = document.getElementById('duplicateWarning');
            warningEl.innerHTML = `⚠️ 以下の教科はすでに保存済みです（再取り込みで上書き）: ${dups.map(d => d.subject).join("、")}`;
            warningEl.style.display = "block";
        }
    });
}

// ============================================================
// イベントリスナー設定
// ============================================================
function bindAllEventListeners() {

    // ---- 問題別結果: 取り込み ----
    document.getElementById('btnImport').addEventListener('click', async () => {
        if (!currentScrapedDataArray?.length) return;
        const { tests = {} } = await chrome.storage.local.get("tests");
        currentScrapedDataArray.forEach(data => { tests[data.testId] = data; });
        await chrome.storage.local.set({ tests });
        alert(`${currentScrapedDataArray.length}教科分のデータを取り込みました！`);
        await updateAllViews();
    });

    // ---- 成績集計: 取り込み ----
    document.getElementById('btnImportSummary').addEventListener('click', async () => {
        if (!currentSummaryData) return;
        const { summaries = {} } = await chrome.storage.local.get("summaries");
        summaries[currentSummaryData.summaryId] = currentSummaryData;
        await chrome.storage.local.set({ summaries });
        const typeLabel = currentSummaryData.examType === 'public' ? '全国公開模試' : '学習力育成テスト';
        alert(`${typeLabel}の成績集計データを取り込みました！\n（${currentSummaryData.summaryId}）`);
        await updateSummaryView();
    });

    // ---- ログコピー ----
    document.getElementById('btnCopyLog').addEventListener('click', () => {
        const logText = document.getElementById('debugLog').textContent;
        navigator.clipboard.writeText(logText).then(() => {
            const btn = document.getElementById('btnCopyLog');
            btn.textContent = "✅ コピーしました！";
            setTimeout(() => { btn.textContent = "📋 ログをコピー"; }, 2000);
        });
    });

    // ---- 問題別結果: JSONダウンロード ----
    document.getElementById('btnDownload').addEventListener('click', async () => {
        const filtered = await getFilteredTests();
        if (!filtered.length) { alert("ダウンロードするデータがありません。"); return; }
        downloadJson({
            version: "2.0", exportedAt: new Date().toISOString(),
            filter: { from: dateFilterFrom ?? null, to: dateFilterTo ?? null },
            tests: filtered
        }, `nichinoken_test_data_${today()}.json`);
    });

    // ---- 成績集計: JSONダウンロード ----
    document.getElementById('btnDownloadSummary').addEventListener('click', async () => {
        const { summaries = {} } = await chrome.storage.local.get("summaries");
        const all = Object.values(summaries);
        if (!all.length) { alert("ダウンロードする成績集計データがありません。"); return; }
        downloadJson({
            version: "1.0", type: "summary",
            exportedAt: new Date().toISOString(),
            summaries: all
        }, `nichinoken_summary_data_${today()}.json`);
    });

    // ---- 問題別結果: JSONインポート ----
    document.getElementById('fileImport').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        readJsonFile(file, async (importedData) => {
            if (!Array.isArray(importedData.tests)) throw new Error("対応していないフォーマットです");
            const { tests = {} } = await chrome.storage.local.get("tests");
            let imported = 0, overwritten = 0;
            importedData.tests.forEach(test => {
                if (!test.testId) return;
                if (tests[test.testId]) overwritten++;
                tests[test.testId] = test;
                imported++;
            });
            await chrome.storage.local.set({ tests });
            alert(`${imported}件を復元しました。${overwritten > 0 ? `（うち${overwritten}件を上書き）` : ''}`);
            await updateAllViews();
        });
        event.target.value = '';
    });

    // ---- 成績集計: JSONインポート ----
    document.getElementById('fileImportSummary').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        readJsonFile(file, async (importedData) => {
            if (!Array.isArray(importedData.summaries)) throw new Error("成績集計フォーマットが正しくありません（summaries配列が必要）");
            const { summaries = {} } = await chrome.storage.local.get("summaries");
            let imported = 0, overwritten = 0;
            importedData.summaries.forEach(s => {
                if (!s.summaryId) return;
                if (summaries[s.summaryId]) overwritten++;
                summaries[s.summaryId] = s;
                imported++;
            });
            await chrome.storage.local.set({ summaries });
            alert(`${imported}件の成績集計を復元しました。${overwritten > 0 ? `（うち${overwritten}件を上書き）` : ''}`);
            await updateSummaryView();
        });
        event.target.value = '';
    });

    // ---- 問題別結果: 古いデータ削除 ----
    document.getElementById('btnDeleteOld').addEventListener('click', async () => {
        const cutoff = prompt("この日付より前のデータを削除します。\n例: 2026-01-01");
        if (!cutoff) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) { alert("YYYY-MM-DD 形式で入力してください。"); return; }
        const { tests = {} } = await chrome.storage.local.get("tests");
        const newTests = {};
        let deleted = 0;
        Object.entries(tests).forEach(([id, test]) => {
            if (test.examDate?.isoDate && test.examDate.isoDate < cutoff) { deleted++; }
            else { newTests[id] = test; }
        });
        if (!deleted) { alert("削除対象のデータはありませんでした。"); return; }
        if (confirm(`${deleted}件のデータを削除します。\n（削除前にJSONのダウンロードを推奨します）`)) {
            await chrome.storage.local.set({ tests: newTests });
            alert(`${deleted}件を削除しました。`);
            await updateAllViews();
        }
    });

    // ---- 問題別結果: 全クリア ----
    document.getElementById('btnClear').addEventListener('click', async () => {
        if (confirm("本当にすべての問題別結果データを削除しますか？\n（この操作は取り消せません）")) {
            await chrome.storage.local.remove("tests");
            await updateAllViews();
            alert("問題別結果データを削除しました。");
        }
    });

    // ---- 成績集計: 全クリア ----
    document.getElementById('btnClearSummary').addEventListener('click', async () => {
        if (confirm("本当にすべての成績集計データを削除しますか？\n（この操作は取り消せません）")) {
            await chrome.storage.local.remove("summaries");
            await updateSummaryView();
            alert("成績集計データを削除しました。");
        }
    });

    // ---- 期間フィルタ ----
    document.getElementById('btnApplyFilter').addEventListener('click', async () => {
        dateFilterFrom = document.getElementById('filterFrom').value || null;
        dateFilterTo   = document.getElementById('filterTo').value   || null;
        await updateAllViews();
    });
    document.getElementById('btnResetFilter').addEventListener('click', async () => {
        dateFilterFrom = null;
        dateFilterTo   = null;
        document.getElementById('filterFrom').value = '';
        document.getElementById('filterTo').value   = '';
        await updateAllViews();
    });

    // ---- 教科タブ ----
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', async () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeSubjectFilter = tab.dataset.subject;
            await updateAllViews();
        });
    });
}

// ============================================================
// ヘルパー関数
// ============================================================

function formatExamDate(examDate, fallback) {
    if (examDate?.isoDate) {
        const roundStr = examDate.round ? ` 第${examDate.round}回` : '';
        return `${examDate.grade ?? '?'}年生${roundStr} ${examDate.year}年${examDate.month}月${examDate.day}日`;
    }
    return fallback;
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: true });
}

function readJsonFile(file, callback) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            await callback(data);
        } catch (err) {
            alert("ファイル読み込みに失敗しました。\n" + err.message);
        }
    };
    reader.readAsText(file);
}

async function getFilteredTests() {
    const { tests = {} } = await chrome.storage.local.get("tests");
    let arr = Object.values(tests);
    if (dateFilterFrom) arr = arr.filter(t => (t.examDate?.isoDate ?? '') >= dateFilterFrom);
    if (dateFilterTo)   arr = arr.filter(t => (t.examDate?.isoDate ?? '') <= dateFilterTo);
    return arr;
}

// ============================================================
// ビュー更新
// ============================================================

async function updateSummaryView() {
    const { summaries = {} } = await chrome.storage.local.get("summaries");
    const all       = Object.values(summaries);
    const training  = all.filter(s => s.examType === 'training');
    const pub       = all.filter(s => s.examType === 'public');

    document.getElementById('lblSummaryStoredCount').textContent = all.length;
    document.getElementById('lblTrainingCount').textContent      = training.length;
    document.getElementById('lblPublicCount').textContent        = pub.length;

    const dates = all.map(s => s.examDate?.isoDate).filter(Boolean).sort();
    document.getElementById('lblSummaryDateRange').textContent =
        dates.length > 0 ? `${dates[0]} 〜 ${dates[dates.length - 1]}` : "--";
}

async function updateAllViews() {
    const allTests = await getFilteredTests();

    // 問題別結果 概要
    const { tests = {} } = await chrome.storage.local.get("tests");
    document.getElementById('lblStoredCount').textContent = Object.keys(tests).length;
    const dates = Object.values(tests).map(t => t.examDate?.isoDate).filter(Boolean).sort();
    document.getElementById('lblDateRange').textContent =
        dates.length > 0 ? `${dates[0]} 〜 ${dates[dates.length - 1]}` : "--";

    // 教科フィルタ適用
    const filtered = (activeSubjectFilter === "all")
        ? allTests
        : allTests.filter(t => t.subject === activeSubjectFilter);

    updateWeakUnits(filtered);
    updateCriticalMisses(filtered);
    updateRecoveryTracker(allTests);

    await updateSummaryView();
}

// ============================================================
// ③ 苦手単元ランキング
// ============================================================
function updateWeakUnits(testsArray) {
    const weakMap = {};
    testsArray.forEach(test => {
        test.questions.forEach(q => {
            if (q.result && q.result !== '未掲載' && (q.result.includes('×') || q.result === 'レ')) {
                if (!weakMap[q.category]) weakMap[q.category] = { count: 0, subjects: new Set() };
                weakMap[q.category].count++;
                weakMap[q.category].subjects.add(test.subject);
            }
        });
    });

    const list = document.getElementById('weakUnitsList');
    list.innerHTML = "";

    const sorted = Object.entries(weakMap)
        .map(([name, v]) => ({ name, count: v.count, subjects: [...v.subjects] }))
        .sort((a, b) => b.count - a.count);

    if (!sorted.length) { list.textContent = "苦手な単元はまだ記録されていません。"; return; }

    sorted.slice(0, 15).forEach(unit => {
        const div = document.createElement('div');
        div.className = "weak-item";
        unit.subjects.forEach(subj => {
            const badge = document.createElement('span');
            badge.className = `weak-item-subject subject-${subj}`;
            badge.textContent = subj;
            div.appendChild(badge);
        });
        const title = document.createElement('span');
        title.className = "weak-item-title";
        title.textContent = unit.name;
        const count = document.createElement('span');
        count.className = "weak-item-count";
        count.textContent = `${unit.count}回`;
        div.appendChild(title);
        div.appendChild(count);
        list.appendChild(div);
    });
}

// ============================================================
// ④ 要注意問題（全体正答率が高いのに間違えた問題）
// ============================================================
function updateCriticalMisses(testsArray) {
    const criticals = [];
    testsArray.forEach(test => {
        test.questions.forEach(q => {
            if (q.result && q.result !== '未掲載' &&
                (q.result.includes('×') || q.result === 'レ') &&
                q.correctRate >= 60) {
                criticals.push({
                    subject: test.subject,
                    date:    test.examDate?.isoDate ?? test.testDateRaw,
                    number:  q.number,
                    unit:    q.rawUnit,
                    correctRate: q.correctRate
                });
            }
        });
    });
    criticals.sort((a, b) => b.correctRate - a.correctRate);

    const container = document.getElementById('criticalMissList');
    container.innerHTML = "";
    if (!criticals.length) { container.textContent = "該当する問題はありません。素晴らしい！"; return; }

    criticals.slice(0, 10).forEach(c => {
        const div = document.createElement('div');
        div.className = "critical-item";
        const badge = document.createElement('span');
        badge.className = `weak-item-subject subject-${c.subject}`;
        badge.textContent = c.subject;
        const label = document.createElement('span');
        label.className = "critical-label";
        label.textContent = `${c.number} ${c.unit}`;
        const rate = document.createElement('span');
        rate.className = "critical-rate";
        rate.textContent = `全体正答率 ${c.correctRate}%`;
        div.appendChild(badge);
        div.appendChild(label);
        div.appendChild(rate);
        container.appendChild(div);
    });
}

// ============================================================
// ⑤ 苦手克服トラッカー
// ============================================================
function updateRecoveryTracker(allTests) {
    const sorted = [...allTests]
        .filter(t => t.examDate?.isoDate)
        .sort((a, b) => a.examDate.isoDate.localeCompare(b.examDate.isoDate));

    if (sorted.length < 2) {
        document.getElementById('recoveryList').textContent = "2回以上のテストデータが必要です。";
        return;
    }

    // 教科ごとに履歴を構築
    const history = {};
    sorted.forEach(test => {
        if (!history[test.subject]) history[test.subject] = [];
        history[test.subject].push(test);
    });

    const recoveries = [];
    Object.entries(history).forEach(([subject, tests]) => {
        if (tests.length < 2) return;
        const latest   = tests[tests.length - 1];
        const older    = tests.slice(0, -1);
        const pastWeak = new Set();
        older.forEach(t => t.questions.forEach(q => {
            if (q.result && q.result !== '未掲載' && (q.result.includes('×') || q.result === 'レ'))
                pastWeak.add(q.category);
        }));
        latest.questions.forEach(q => {
            if (q.result === '○' && pastWeak.has(q.category))
                recoveries.push({ subject, category: q.category, latestDate: latest.examDate.isoDate });
        });
    });

    const container = document.getElementById('recoveryList');
    container.innerHTML = "";
    if (!recoveries.length) { container.textContent = "まだ克服データがありません。テストを重ねると自動的に判定されます。"; return; }

    // 重複除去
    const seen = new Set();
    const unique = recoveries.filter(r => {
        const key = `${r.subject}_${r.category}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    unique.forEach(r => {
        const div = document.createElement('div');
        div.className = "recovery-item";
        div.appendChild(Object.assign(document.createElement('span'), { className: "recovery-badge", textContent: "🎉" }));
        div.appendChild(Object.assign(document.createElement('span'), { className: `weak-item-subject subject-${r.subject}`, textContent: r.subject }));
        div.appendChild(Object.assign(document.createElement('span'), { className: "recovery-label", textContent: `${r.category}（${r.latestDate}に正解！）` }));
        container.appendChild(div);
    });
}
