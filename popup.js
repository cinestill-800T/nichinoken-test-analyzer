let currentScrapedDataArray = null;
let activeSubjectFilter = "all";
let dateFilterFrom = null;
let dateFilterTo = null;

document.addEventListener('DOMContentLoaded', async () => {
    await updateAllViews();

    // ---- ① ページスクレイピング ----
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return;

        chrome.tabs.sendMessage(tabs[0].id, { action: "scrapeTestData" }, async (response) => {
            const pageStatus = document.getElementById('pageStatus');

            // ---- 診断ログの表示 ----
            if (response && response.logs && response.logs.length > 0) {
                const debugSection = document.getElementById('debugSection');
                const debugLog = document.getElementById('debugLog');
                debugSection.style.display = "block";
                debugLog.textContent = response.logs.join("\n");
            }

            if (chrome.runtime.lastError || !response || !response.success || !response.data || response.data.length === 0) {
                const errMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : (response?.error || "不明なエラー");
                pageStatus.textContent = `⚠ テスト結果を取得できませんでした: ${errMsg}`;
                // エラーでもログがあれば表示済み
                return;
            }

            pageStatus.textContent = `✅ ${response.data.length}教科分のテスト結果を検出しました！`;
            currentScrapedDataArray = response.data;

            const firstData = currentScrapedDataArray[0];
            const summarySubjects = currentScrapedDataArray.map(d => d.subject).join("、");
            const summaryScores = currentScrapedDataArray.map(d => `${d.subject}: ${d.score || "-"}`).join(" / ");

            document.getElementById('lblTestName').textContent = firstData.testName;
            document.getElementById('lblSubject').textContent = summarySubjects;
            document.getElementById('lblExamDate').textContent =
                firstData.examDate.isoDate
                    ? `${firstData.examDate.grade || '?'}年生 ${firstData.examDate.year}年${firstData.examDate.month}月${firstData.examDate.day}日`
                    : firstData.testDateRaw;
            document.getElementById('lblScore').textContent = summaryScores;
            document.getElementById('scrapeResult').style.display = "block";

            // 重複チェック
            const { tests = {} } = await chrome.storage.local.get("tests");
            const duplicated = currentScrapedDataArray.filter(d => tests[d.testId]);
            if (duplicated.length > 0) {
                const dupSubjects = duplicated.map(d => d.subject).join("、");
                const warningEl = document.getElementById('duplicateWarning');
                warningEl.innerHTML = `⚠️ 以下の教科はすでに保存済みです。再取り込みすると上書きされます。<br>(${dupSubjects})`;
                warningEl.style.display = "block";
            }
            
            document.getElementById('btnImport').textContent = `${currentScrapedDataArray.length}教科分をまとめて取り込んで保存`;
        });
    });

    // ---- 取り込みボタン ----
    document.getElementById('btnImport').addEventListener('click', async () => {
        if (!currentScrapedDataArray || currentScrapedDataArray.length === 0) return;

        const { tests = {} } = await chrome.storage.local.get("tests");
        currentScrapedDataArray.forEach(data => {
            tests[data.testId] = data;
        });
        await chrome.storage.local.set({ tests });

        alert(`${currentScrapedDataArray.length}教科分のデータを取り込みました！`);
        await updateAllViews();
    });

    // ---- ログコピーボタン ----
    document.getElementById('btnCopyLog').addEventListener('click', () => {
        const logText = document.getElementById('debugLog').textContent;
        navigator.clipboard.writeText(logText).then(() => {
            document.getElementById('btnCopyLog').textContent = "✅ コピーしました！";
            setTimeout(() => {
                document.getElementById('btnCopyLog').textContent = "📋 ログをコピー";
            }, 2000);
        });
    });

    // ---- JSONダウンロード ----
    document.getElementById('btnDownload').addEventListener('click', async () => {
        const filtered = await getFilteredTests();
        if (filtered.length === 0) {
            alert("ダウンロードするデータがありません。");
            return;
        }

        const exportData = {
            version: "2.0",
            exportedAt: new Date().toISOString(),
            filter: {
                from: dateFilterFrom || null,
                to: dateFilterTo || null
            },
            tests: filtered
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        chrome.downloads.download({
            url: url,
            filename: "nichinoken_test_data_" + new Date().toISOString().slice(0, 10) + ".json",
            saveAs: true
        });
    });

    // ---- JSONインポート ----
    document.getElementById('fileImport').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                if (!importedData.tests || !Array.isArray(importedData.tests)) {
                    throw new Error("対応していないフォーマットです");
                }

                const { tests = {} } = await chrome.storage.local.get("tests");

                let importedCount = 0;
                let skippedCount = 0;
                importedData.tests.forEach(test => {
                    if (test.testId) {
                        if (tests[test.testId]) {
                            skippedCount++;
                        }
                        tests[test.testId] = test;
                        importedCount++;
                    }
                });

                await chrome.storage.local.set({ tests });
                let msg = `${importedCount}件のテストデータを復元しました！`;
                if (skippedCount > 0) {
                    msg += `\n（うち${skippedCount}件は既存データを上書き更新）`;
                }
                alert(msg);
                await updateAllViews();
            } catch (error) {
                alert("ファイルの読み込みに失敗しました。\n" + error.message);
            }
            event.target.value = '';
        };
        reader.readAsText(file);
    });

    // ---- 古いデータ削除 ----
    document.getElementById('btnDeleteOld').addEventListener('click', async () => {
        const cutoff = prompt("この日付より前のデータを削除します。\n日付を入力してください (例: 2026-01-01):");
        if (!cutoff) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
            alert("日付の形式が正しくありません。YYYY-MM-DDの形式で入力してください。");
            return;
        }

        const { tests = {} } = await chrome.storage.local.get("tests");
        let deletedCount = 0;
        const newTests = {};

        Object.entries(tests).forEach(([id, test]) => {
            const iso = test.examDate?.isoDate;
            if (iso && iso < cutoff) {
                deletedCount++;
            } else {
                newTests[id] = test;
            }
        });

        if (deletedCount === 0) {
            alert("削除対象のデータはありませんでした。");
            return;
        }

        if (confirm(`${deletedCount}件のデータを削除します。よろしいですか？\n（削除前にJSONのダウンロードを推奨します）`)) {
            await chrome.storage.local.set({ tests: newTests });
            alert(`${deletedCount}件のデータを削除しました。`);
            await updateAllViews();
        }
    });

    // ---- 全データクリア ----
    document.getElementById('btnClear').addEventListener('click', async () => {
        if (confirm("本当にすべての蓄積データを削除しますか？\n（ダウンロードしていないデータは永遠に失われます）")) {
            await chrome.storage.local.remove("tests");
            await updateAllViews();
            alert("削除しました。");
        }
    });

    // ---- 期間フィルタ ----
    document.getElementById('btnApplyFilter').addEventListener('click', async () => {
        dateFilterFrom = document.getElementById('filterFrom').value || null;
        dateFilterTo = document.getElementById('filterTo').value || null;
        await updateAllViews();
    });

    document.getElementById('btnResetFilter').addEventListener('click', async () => {
        dateFilterFrom = null;
        dateFilterTo = null;
        document.getElementById('filterFrom').value = '';
        document.getElementById('filterTo').value = '';
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
});

// ============================================================================
// フィルタ済みテスト取得
// ============================================================================
async function getFilteredTests() {
    const { tests = {} } = await chrome.storage.local.get("tests");
    let testsArray = Object.values(tests);

    // 日付フィルタ
    if (dateFilterFrom) {
        testsArray = testsArray.filter(t => (t.examDate?.isoDate || "") >= dateFilterFrom);
    }
    if (dateFilterTo) {
        testsArray = testsArray.filter(t => (t.examDate?.isoDate || "") <= dateFilterTo);
    }

    return testsArray;
}

// ============================================================================
// 全ビュー一括更新
// ============================================================================
async function updateAllViews() {
    const allTests = await getFilteredTests();

    // --- 蓄積データ概要 ---
    const { tests = {} } = await chrome.storage.local.get("tests");
    const totalCount = Object.keys(tests).length;
    document.getElementById('lblStoredCount').textContent = totalCount;

    // 日付の範囲表示
    const dates = Object.values(tests)
        .map(t => t.examDate?.isoDate)
        .filter(Boolean)
        .sort();
    document.getElementById('lblDateRange').textContent =
        dates.length > 0 ? `${dates[0]} 〜 ${dates[dates.length - 1]}` : "--";

    // --- 教科フィルタ適用 ---
    let filtered = allTests;
    if (activeSubjectFilter !== "all") {
        filtered = allTests.filter(t => t.subject === activeSubjectFilter);
    }

    updateWeakUnits(filtered);
    updateCriticalMisses(filtered);
    updateRecoveryTracker(allTests); // 克服は全教科で見る
}

// ============================================================================
// ③ 苦手単元ランキング
// ============================================================================
function updateWeakUnits(testsArray) {
    const weakUnits = {};

    testsArray.forEach(test => {
        test.questions.forEach(q => {
            if (q.result && q.result !== '未掲載' && (q.result.includes('×') || q.result === 'レ')) {
                const key = q.category;
                if (!weakUnits[key]) {
                    weakUnits[key] = { count: 0, subjects: new Set() };
                }
                weakUnits[key].count++;
                weakUnits[key].subjects.add(test.subject);
            }
        });
    });

    const weakList = document.getElementById('weakUnitsList');
    weakList.innerHTML = "";

    const sortedUnits = Object.keys(weakUnits)
        .map(key => ({
            name: key,
            count: weakUnits[key].count,
            subjects: [...weakUnits[key].subjects]
        }))
        .sort((a, b) => b.count - a.count);

    if (sortedUnits.length === 0) {
        weakList.textContent = "苦手な単元はまだ記録されていません。";
        return;
    }

    sortedUnits.slice(0, 15).forEach(unit => {
        const div = document.createElement('div');
        div.className = "weak-item";

        // 教科バッジ
        unit.subjects.forEach(subj => {
            const badge = document.createElement('span');
            badge.className = `weak-item-subject subject-${subj}`;
            badge.textContent = subj;
            div.appendChild(badge);
        });

        const titleSpan = document.createElement('span');
        titleSpan.className = "weak-item-title";
        titleSpan.textContent = unit.name;

        const countSpan = document.createElement('span');
        countSpan.className = "weak-item-count";
        countSpan.textContent = `${unit.count}回`;

        div.appendChild(titleSpan);
        div.appendChild(countSpan);
        weakList.appendChild(div);
    });
}

// ============================================================================
// ④ 要注意問題（全体正答率が高いのに間違えた問題）
// ============================================================================
function updateCriticalMisses(testsArray) {
    const criticals = [];

    testsArray.forEach(test => {
        test.questions.forEach(q => {
            if (q.result && q.result !== '未掲載' && (q.result.includes('×') || q.result === 'レ') && q.correctRate >= 60) {
                criticals.push({
                    subject: test.subject,
                    date: test.examDate?.isoDate || test.testDateRaw,
                    number: q.number,
                    unit: q.rawUnit,
                    correctRate: q.correctRate
                });
            }
        });
    });

    // 正答率が高い順（＝より恥ずかしいミスを上に）
    criticals.sort((a, b) => b.correctRate - a.correctRate);

    const container = document.getElementById('criticalMissList');
    container.innerHTML = "";

    if (criticals.length === 0) {
        container.textContent = "該当する問題はありません。素晴らしい！";
        return;
    }

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

// ============================================================================
// ⑤ 苦手克服トラッカー
// ============================================================================
function updateRecoveryTracker(allTests) {
    // テストを日付順にソート
    const sorted = [...allTests]
        .filter(t => t.examDate?.isoDate)
        .sort((a, b) => (a.examDate.isoDate).localeCompare(b.examDate.isoDate));

    if (sorted.length < 2) {
        document.getElementById('recoveryList').textContent = "2回以上のテストデータが必要です。";
        return;
    }

    // 各教科ごとに、過去のテストで×だった単元が最新では○になったか判定
    const subjectHistory = {};
    sorted.forEach(test => {
        if (!subjectHistory[test.subject]) {
            subjectHistory[test.subject] = [];
        }
        subjectHistory[test.subject].push(test);
    });

    const recoveries = [];

    Object.entries(subjectHistory).forEach(([subject, tests]) => {
        if (tests.length < 2) return;

        const latestTest = tests[tests.length - 1];
        const olderTests = tests.slice(0, -1);

        // 過去で(×)だった単元カテゴリを収集
        const pastWeakCategories = new Set();
        olderTests.forEach(t => {
            t.questions.forEach(q => {
                if (q.result && q.result !== '未掲載' && (q.result.includes('×') || q.result === 'レ')) {
                    pastWeakCategories.add(q.category);
                }
            });
        });

        // 最新テストで○になった同じカテゴリを発見
        latestTest.questions.forEach(q => {
            if (q.result === '○' && pastWeakCategories.has(q.category)) {
                recoveries.push({
                    subject,
                    category: q.category,
                    detail: q.rawUnit,
                    latestDate: latestTest.examDate.isoDate
                });
            }
        });
    });

    const container = document.getElementById('recoveryList');
    container.innerHTML = "";

    if (recoveries.length === 0) {
        container.textContent = "まだ克服データがありません。テストを重ねると自動的に判定されます。";
        return;
    }

    // 重複除去(同じカテゴリ×教科)
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

        const badge = document.createElement('span');
        badge.className = "recovery-badge";
        badge.textContent = "🎉";

        const subjBadge = document.createElement('span');
        subjBadge.className = `weak-item-subject subject-${r.subject}`;
        subjBadge.textContent = r.subject;

        const label = document.createElement('span');
        label.className = "recovery-label";
        label.textContent = `${r.category}（${r.latestDate}に正解！）`;

        div.appendChild(badge);
        div.appendChild(subjBadge);
        div.appendChild(label);
        container.appendChild(div);
    });
}
