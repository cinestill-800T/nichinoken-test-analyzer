// ============================================================
// Nichinoken Test Data Extractor v4.0 — Popup Script
// パッケージ取得 + 既存単体抽出 デュアルモード
// ============================================================

let currentExtractedData = null;

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    bindAllEventListeners();

    // ストレージの収集状態を確認
    chrome.storage.local.get(['nichinokenCollection', 'nichinokenPackageProgress'], (stored) => {

        // 分野別正答率の収集完了チェック
        if (stored.nichinokenCollection?.status === 'done') {
            chrome.storage.local.remove('nichinokenCollection');
            const finalData = {
                version: "3.0",
                dataType: "fieldAccuracyRateAll",
                extractedAt: new Date().toISOString(),
                combinations: stored.nichinokenCollection.results
            };
            currentExtractedData = finalData;
            showBulkResults(finalData);
            document.getElementById('extractResult').style.display = "block";
            return;
        }

        if (stored.nichinokenCollection?.status === 'collecting') {
            const total = stored.nichinokenCollection.combinations.length;
            const n = stored.nichinokenCollection.results?.length ?? 0;
            document.getElementById('pageStatus').textContent =
                `⏳ データ取得中... (${n} / ${total}) 完了後にもう一度開いてください`;
            setBadge('取得中', 'badge-info');
            return;
        }

        // 通常フロー → アクティブタブのURLで判定
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) return;
            const tab = tabs[0];
            const url = tab.url || '';

            // ---- モード判定 ----

            // トップページ or 過去テスト一覧 → パッケージモード
            if (url.includes('examination-review-top') || url.includes('examination-review-list') || url.includes('examination-public-trial-review-list') || url.includes('examination-training-special-review-list')) {
                activatePackageMode(tab);
                return;
            }

            // Bookendビューア
            const isBookend = url.includes('open-problem.html') || url.includes('open-answer.html');
            if (isBookend) {
                activateBookendMode(tab);
                return;
            }

            // 分野別正答率
            const isFieldPage = url.includes('correct-answer-rate-by-field-list');

            // 詳細ページ → 既存の単体抽出モード
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
                    setBadge('未接続', 'badge-error');
                    return;
                }
                handleScrapeResponse(response);
            });
        });
    });
});

// ============================================================
// パッケージモード（トップページ）
// ============================================================

function activatePackageMode(tab) {
    document.getElementById('singleMode').style.display = 'none';
    document.getElementById('packageMode').style.display = 'block';

    // テスト一覧をスキャン
    chrome.tabs.sendMessage(tab.id, { action: "scanTestList" }, (response) => {
        if (chrome.runtime.lastError) {
            document.getElementById('pkgStatus').textContent =
                '⚠ ページを更新（F5）してから再度お試しください。';
            document.getElementById('pkgBadge').textContent = '未接続';
            document.getElementById('pkgBadge').className = 'badge badge-error';
            return;
        }

        if (!response?.success || !response.tests || response.tests.length === 0) {
            document.getElementById('pkgStatus').textContent =
                '⚠ テスト一覧が見つかりませんでした。';
            document.getElementById('pkgBadge').textContent = '検出なし';
            document.getElementById('pkgBadge').className = 'badge badge-error';
            return;
        }

        renderTestCheckboxes(response.tests);
        document.getElementById('pkgStatus').textContent =
            `✅ ${response.tests.length}件のテストを検出しました`;
    });
}

function renderTestCheckboxes(tests) {
    const container = document.getElementById('testCheckboxes');
    container.innerHTML = '';

    tests.forEach((test, idx) => {
        const dateStr = test.examDate
            ? `${test.examDate.substring(0, 4)}/${test.examDate.substring(4, 6)}/${test.examDate.substring(6, 8)}`
            : '';
        const subjectCount = Object.keys(test.subjects).length;
        const subjectNames = Object.values(test.subjects).map(s => s.label).join('・');

        const label = document.createElement('label');
        label.className = 'checkbox-item';
        label.innerHTML = `
            <input type="checkbox" class="test-checkbox" data-idx="${idx}" checked>
            <span class="checkbox-label">
                <span class="test-name">${test.testName}</span>
                <span class="test-meta">${dateStr} ｜ ${subjectNames}（${subjectCount}教科）</span>
            </span>
        `;
        container.appendChild(label);
    });

    // テストデータをDOMに保持
    container.dataset.tests = JSON.stringify(tests);
}

// ============================================================
// パッケージ取得実行
// ============================================================

async function executePackageFetch() {
    const container = document.getElementById('testCheckboxes');
    const allTests = JSON.parse(container.dataset.tests || '[]');

    // 選択されたテストを抽出
    const selectedTests = [];
    container.querySelectorAll('.test-checkbox').forEach(cb => {
        if (cb.checked) {
            const idx = parseInt(cb.dataset.idx);
            selectedTests.push(allTests[idx]);
        }
    });

    if (selectedTests.length === 0) {
        alert('少なくとも1つのテストを選択してください。');
        return;
    }

    const options = {
        correctionList: document.getElementById('optCorrectionList').checked,
        commentary: document.getElementById('optCommentary').checked,
        results: document.getElementById('optResults').checked
    };

    if (!options.correctionList && !options.commentary && !options.results) {
        alert('少なくとも1つのデータ種別を選択してください。');
        return;
    }

    const outputFormat = document.querySelector('input[name="outputFormat"]:checked').value;

    // UI更新
    const btn = document.getElementById('btnFetchPackage');
    btn.disabled = true;
    btn.textContent = '⏳ 取得中...';
    document.getElementById('progressArea').style.display = 'block';

    // ストレージをクリアしてから開始
    await chrome.storage.local.remove(['nichinokenPackageProgress', 'nichinokenPackageResult']);

    // content scriptにパッケージ取得を依頼（即座にstartedが返る）
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        chrome.tabs.sendMessage(tabs[0].id, {
            action: "fetchTestPackage",
            config: { tests: selectedTests, options }
        }, (response) => {
            if (chrome.runtime.lastError || !response?.success) {
                btn.disabled = false;
                btn.textContent = '📥 パッケージをダウンロード';
                document.getElementById('pkgStatus').textContent = '⚠ 接続エラー。ページを更新（F5）してください。';
                return;
            }
            // 取得開始成功 → ポーリングで進捗と結果を監視
            startPollingForResults(btn, outputFormat);
        });
    });
}

function startPollingForResults(btn, outputFormat) {
    const pollInterval = setInterval(() => {
        chrome.storage.local.get(['nichinokenPackageProgress', 'nichinokenPackageResult'], (stored) => {
            const prog = stored.nichinokenPackageProgress;
            const result = stored.nichinokenPackageResult;

            // 進捗更新
            if (prog && prog.status === 'collecting') {
                const pct = prog.total > 0 ? Math.round((prog.completed / prog.total) * 100) : 0;
                document.getElementById('progressFill').style.width = `${pct}%`;
                document.getElementById('progressText').textContent =
                    `${prog.detail || ''} (${prog.completed}/${prog.total})`;
            }

            // エラー
            if (prog && prog.status === 'error') {
                clearInterval(pollInterval);
                btn.disabled = false;
                btn.textContent = '📥 パッケージをダウンロード';
                document.getElementById('pkgStatus').textContent = `⚠ ${prog.error || '取得に失敗しました'}`;
                chrome.storage.local.remove(['nichinokenPackageProgress', 'nichinokenPackageResult']);
                return;
            }

            // 完了 → 結果を処理
            if (result && result.success) {
                clearInterval(pollInterval);
                handlePackageResult(result, btn, outputFormat);
            }
        });
    }, 500);
}

async function handlePackageResult(result, btn, outputFormat) {
    // ログ表示
    if (result.logs?.length > 0) {
        document.getElementById('pkgDebugSection').style.display = 'block';
        document.getElementById('pkgDebugLog').textContent = result.logs.join('\n');
    }

    // 完了UI
    document.getElementById('progressFill').style.width = '100%';
    document.getElementById('progressText').textContent = '✅ 全データ取得完了！';

    const packageData = buildPackageData(result.results);
    currentExtractedData = packageData;

    try {
        if (outputFormat === 'zip') {
            await downloadAsZip(packageData, result.results);
        } else {
            downloadJson(packageData, generatePackageFilename(packageData));
        }
        document.getElementById('pkgStatus').textContent = '✅ ダウンロード完了！';
        document.getElementById('pkgBadge').textContent = '完了';
        document.getElementById('pkgBadge').className = 'badge badge-success';
    } catch (e) {
        document.getElementById('pkgStatus').textContent = `⚠ ダウンロードエラー: ${e.message}`;
    }

    btn.disabled = false;
    btn.textContent = '📥 パッケージをダウンロード';

    // ストレージをクリア
    chrome.storage.local.remove(['nichinokenPackageProgress', 'nichinokenPackageResult']);
}

// ============================================================
// パッケージデータ構築
// ============================================================

function buildPackageData(results) {
    return {
        version: "4.0",
        dataType: "testPackage",
        extractedAt: new Date().toISOString(),
        testCount: results.length,
        tests: results.map(r => ({
            testName: r.testName,
            examDate: r.examDate,
            examKnd: r.examKnd,
            subjects: r.subjects || [],
            summary: r.summary || null
        }))
    };
}

// ============================================================
// ZIPダウンロード
// ============================================================

async function downloadAsZip(packageData, results) {
    const zip = new JSZip();
    const dateStr = new Date().toISOString().slice(0, 10);

    // metadata.json
    const metadata = {
        version: "4.0",
        createdAt: new Date().toISOString(),
        testCount: results.length,
        tests: results.map(r => ({
            testName: r.testName,
            examDate: r.examDate,
            subjectCount: r.subjects?.length || 0,
            hasSummary: !!r.summary
        }))
    };
    zip.file("metadata.json", JSON.stringify(metadata, null, 2));

    // 各テストのデータ
    for (const test of results) {
        const examDateStr = test.examDate || 'unknown';
        const safeName = (test.testName || 'test').replace(/[\/\\:*?"<>|]/g, '_');
        const folderName = `${safeName}_${examDateStr}`;
        const folder = zip.folder(folderName);

        // 正誤一覧（教科別）
        if (test.subjects && test.subjects.length > 0) {
            const seigoFolder = folder.folder("正誤一覧");
            for (const subj of test.subjects) {
                const subjName = (subj.subject || 'unknown').replace(/[\/\\:*?"<>|]/g, '_');
                seigoFolder.file(`${subjName}.json`, JSON.stringify(subj, null, 2));
            }
        }

        // 解説（教科別）
        if (test.commentary && Object.keys(test.commentary).length > 0) {
            const commentaryFolder = folder.folder("解説");
            for (const [subjName, commentaryData] of Object.entries(test.commentary)) {
                const safeSub = subjName.replace(/[\/\\:*?"<>|]/g, '_');
                // テキスト版
                commentaryFolder.file(`${safeSub}_解説.txt`, commentaryData.text || '');
                // HTML版
                if (commentaryData.htmlRaw) {
                    commentaryFolder.file(`${safeSub}_解説.html`, commentaryData.htmlRaw);
                }
            }
        }

        // 解答PDFリンク
        if (test.answerPdfUrls && Object.keys(test.answerPdfUrls).length > 0) {
            folder.file("解答PDFリンク.json", JSON.stringify(test.answerPdfUrls, null, 2));
        }

        // 成績集計
        if (test.summary) {
            folder.file("成績集計.json", JSON.stringify(test.summary, null, 2));
        }

        // 統合データ
        const unified = {
            version: "4.0",
            testName: test.testName,
            examDate: test.examDate,
            subjects: test.subjects || [],
            commentary: test.commentary || {},
            answerPdfUrls: test.answerPdfUrls || {},
            summary: test.summary || null,
            extractedAt: new Date().toISOString()
        };
        folder.file("統合データ.json", JSON.stringify(unified, null, 2));
    }

    // ZIP生成＆ダウンロード
    const blob = await zip.generateAsync({ type: "blob" });
    const objectUrl = URL.createObjectURL(blob);
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    const filename = `nichinoken_${ts}_package.zip`;

    return new Promise((resolve, reject) => {
        chrome.downloads.download({
            url: objectUrl,
            filename,
            saveAs: false  // ポップアップが閉じる問題を回避
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Download error:", chrome.runtime.lastError.message);
                URL.revokeObjectURL(objectUrl);
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            // ダウンロード開始後、少し待ってからURLを解放
            setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
            resolve(downloadId);
        });
    });
}

// ============================================================
// Bookendモード
// ============================================================

function activateBookendMode(tab) {
    document.getElementById('pageStatus').textContent = '✅ 問題/解答用紙ビューアを検出しました。';
    setBadge('ビューア', 'badge-success');

    document.getElementById('lblTestName').textContent = "問題/解答用紙";
    document.getElementById('lblExamDate').textContent = "--";
    document.getElementById('lblSubjects').textContent = "--";
    document.getElementById('lblSummaryStatus').textContent = "画像ダウンロード";
    document.getElementById('extractResult').style.display = "block";

    const btn = document.getElementById('btnExtractAndDownload');
    btn.innerHTML = '&#x1F4E5; 全ページを画像でダウンロード';
    btn.className = 'btn primary large';

    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', () => {
        document.getElementById('pageStatus').textContent = '⏳ ダウンロード中...（ページめくり自動化中）';
        chrome.tabs.sendMessage(tab.id, { action: "downloadBookendImages" });
    });
}

// ============================================================
// スクレイピング結果の処理（既存）
// ============================================================

function handleScrapeResponse(response) {
    const pageStatus = document.getElementById('pageStatus');

    if (response?.logs?.length > 0) {
        document.getElementById('debugSection').style.display = "block";
        document.getElementById('debugLog').textContent = response.logs.join("\n");
    }

    if (!response?.success || !response.data) {
        pageStatus.textContent = `⚠ ${response?.error ?? "不明なエラー"}`;
        setBadge('エラー', 'badge-error');
        return;
    }

    const data = response.data;

    if (data.dataType === 'collectionStarted') {
        pageStatus.textContent = `⏳ 収集開始しました。完了後にもう一度ポップアップを開いてください。`;
        setBadge('取得中', 'badge-info');
        return;
    }

    currentExtractedData = data;

    if (data.dataType === 'fieldAccuracyRateAll') {
        showBulkResults(data);
    } else if (data.dataType === 'fieldAccuracyRate') {
        pageStatus.textContent = `✅ 分野別正答率データを取得しました！`;
        setBadge('分野別', 'badge-success');
        document.getElementById('lblTestName').textContent = "分野別正答率";
        document.getElementById('lblExamDate').textContent = data.searchCondition.bracketsText || "--";
        const cond = data.searchCondition;
        const condStr = [cond.subject, cond.grade ? cond.grade + "年" : "", cond.term, cond.testType].filter(Boolean).join(" ");
        document.getElementById('lblSubjects').textContent = condStr || "--";
        document.getElementById('lblSummaryStatus').parentElement.querySelector('.result-label').textContent = "データ件数";
        document.getElementById('lblSummaryStatus').textContent = `✅ ${data.fields.length}行のカテゴリ判定`;
    } else {
        const hasSubjects = data.subjects?.length > 0;
        const hasSummary = !!data.summary;

        if (hasSubjects && hasSummary) {
            pageStatus.textContent = `✅ テストデータを統合取得しました！`;
            setBadge('統合取得', 'badge-success');
        } else if (hasSubjects) {
            pageStatus.textContent = `✅ 問題別データを取得しました（成績集計なし）`;
            setBadge('問題別のみ', 'badge-info');
        } else if (hasSummary) {
            pageStatus.textContent = `✅ 成績集計データを取得しました`;
            setBadge('集計のみ', 'badge-info');
        }

        document.getElementById('lblTestName').textContent = data.testName || "--";
        document.getElementById('lblExamDate').textContent = formatExamDate(data.examDate, data.testDateRaw);
        document.getElementById('lblSubjects').textContent = hasSubjects
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

    // ---- パッケージダウンロード ----
    document.getElementById('btnFetchPackage').addEventListener('click', () => {
        executePackageFetch();
    });

    // ---- パッケージログコピー ----
    document.getElementById('btnCopyPkgLog').addEventListener('click', () => {
        navigator.clipboard.writeText(document.getElementById('pkgDebugLog').textContent).then(() => {
            const btn = document.getElementById('btnCopyPkgLog');
            btn.textContent = "✅ コピーしました！";
            setTimeout(() => { btn.textContent = "📋 ログをコピー"; }, 2000);
        });
    });

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
    setBadge('分野別(全件)', 'badge-success');
    document.getElementById('lblTestName').textContent = "分野別正答率（全組み合わせ）";
    document.getElementById('lblExamDate').textContent = "--";
    document.getElementById('lblSubjects').textContent = `${count}件の条件`;
    document.getElementById('lblSummaryStatus').parentElement.querySelector('.result-label').textContent = "データ件数";
    document.getElementById('lblSummaryStatus').textContent = `✅ ${count}条件 / ${totalRows}行`;
}

function setBadge(text, cls) {
    const el = document.getElementById('pageTypeBadge');
    if (el) {
        el.textContent = text;
        el.className = `badge ${cls}`;
    }
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
        const nameParts = ["fields", cond.subject, cond.grade ? cond.grade + "y" : "", cond.termCode, cond.testTypeCode]
            .filter(Boolean).join("_").replace(/[\s\/\\:*?"<>|]/g, '_');
        const date = new Date().toISOString().slice(0, 10);
        return `nichinoken_${date}_${nameParts}.json`;
    }
    const date = data.examDate?.isoDate || new Date().toISOString().slice(0, 10);
    const name = (data.testName || 'test').replace(/[\s\/\\:*?"<>|]/g, '_');
    return `nichinoken_${date}_${name}.json`;
}

function generatePackageFilename(data) {
    const date = new Date().toISOString().slice(0, 10);
    return `nichinoken_${date}_package.json`;
}

function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    chrome.downloads.download({
        url: objectUrl,
        filename,
        saveAs: false
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            console.error("Download error:", chrome.runtime.lastError.message);
        }
        setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    });
}

function showJsonPreview(data) {
    document.getElementById('jsonPreview').textContent = JSON.stringify(data, null, 2);
    document.getElementById('previewCard').style.display = "block";
}
