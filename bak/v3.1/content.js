// ============================================================
// Nichinoken Test Data Extractor v3 — Content Script
// JSON抽出特化版
// ============================================================

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "downloadBookendImages") {
        downloadBookendImagesFlow().then(() => {
            sendResponse({ success: true });
        }).catch(e => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (request.action === "scrapeAllData") {
        if (document.querySelector('.CorrectAnswerRate_table')) {
            if (request.mode === 'allCombinations') {
                (async () => {
                    try {
                        const { combinations } = buildFormCombinations(document);
                        if (combinations.length === 0) {
                            sendResponse({ success: false, error: '有効な組み合わせが0件です', logs: [] });
                            return;
                        }
                        await chrome.storage.local.set({
                            nichinokenCollection: {
                                status: 'collecting',
                                combinations,
                                index: 0,
                                results: []
                            }
                        });
                        sendResponse({
                            success: true,
                            data: { dataType: 'collectionStarted', total: combinations.length },
                            logs: [`[INFO] ${combinations.length}件の組み合わせを開始します`]
                        });
                        _submitFormWithCombo(combinations[0]);
                    } catch (e) {
                        sendResponse({ success: false, error: e.message, logs: [`[FATAL] ${e.message}`] });
                    }
                })();
                return true;
            }

            try {
                const result = scrapeFieldAccuracyRate(document);
                sendResponse({ success: true, data: result, logs: ["[INFO] 分野別正答率データを取得しました"] });
            } catch (e) {
                sendResponse({ success: false, error: e.message, logs: [`[ERROR] ${e.message}`] });
            }
            return true;
        }

        handleUnifiedScrape().then(result => {
            sendResponse(result);
        }).catch(error => {
            sendResponse({ success: false, error: error.message, logs: [`[FATAL] ${error.message}`] });
        });
        return true;
    }
});

// ============================================================
// 共通ユーティリティ
// ============================================================

function parseExamDate(rawDateStr) {
    const gradeMatch = rawDateStr.match(/(\d+)\s*年生/);
    const roundMatch = rawDateStr.match(/第\s*(\d+)\s*回/);
    const dateMatch  = rawDateStr.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);

    const grade = gradeMatch ? parseInt(gradeMatch[1], 10) : null;
    const round = roundMatch ? parseInt(roundMatch[1], 10) : null;
    const year  = dateMatch ? parseInt(dateMatch[1], 10) : null;
    const month = dateMatch ? parseInt(dateMatch[2], 10) : null;
    const day   = dateMatch ? parseInt(dateMatch[3], 10) : null;

    let isoDate = null;
    if (year && month && day) {
        isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return { grade, round, year, month, day, isoDate };
}

function parseCategory(rawUnit) {
    const patterns = [/^(.+?)－(.+)$/,  /^(.+?)[；;](.+)$/, /^(.+?)：(.+)$/, /^(.+?)-(.+)$/];
    for (const regex of patterns) {
        const m = rawUnit.match(regex);
        if (m) {
            return {
                category: m[1].trim(),
                subCategory: m[2].replace(/[；;]\s*$/, '').trim()
            };
        }
    }
    return { category: rawUnit, subCategory: "" };
}

function toNumber(el) {
    const t = el ? el.innerText.trim() : '';
    if (t === '') return null;
    const m = t.match(/[\d.]+/);
    return m ? parseFloat(m[0]) : null;
}

function extractRankings(table) {
    if (!table) return [];
    const result = [];
    table.querySelectorAll('tbody tr').forEach(row => {
        const th  = row.querySelector('th');
        const tds = row.querySelectorAll('td');
        if (!th || tds.length < 4) return;
        const extractNum = el => {
            const m = el.innerText.trim().match(/[\d,]+/);
            return m ? parseInt(m[0].replace(/,/g, ''), 10) : null;
        };
        result.push({
            label:        th.innerText.trim(),
            totalCount:   extractNum(tds[0]),
            myRank:       extractNum(tds[1]),
            genderCount:  extractNum(tds[2]),
            myGenderRank: extractNum(tds[3])
        });
    });
    return result;
}

// ============================================================
// fetchラッパー（タイムアウト付き）
// ============================================================

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

// ============================================================
// サブタブからリンクURLを取得するユーティリティ
// ============================================================

/**
 * ページ内のサブタブ（正誤一覧 / 成績）のリンクURLを取得
 *   side-tab_viewErrata → 正誤一覧ページ
 *   side-tab_viewResults → 成績集計ページ
 */
function getSubTabUrls(doc) {
    const errataEl  = doc.querySelector('.side-tab_viewErrata a');
    const resultsEl = doc.querySelector('.side-tab_viewResults a');
    return {
        errataUrl:  errataEl  ? errataEl.href  : null,
        resultsUrl: resultsEl ? resultsEl.href : null
    };
}

/**
 * 教科タブの全リンクを取得（正誤一覧ページ用）
 * 正誤一覧ページ（exam-type1 / exam-type11）にある教科タブ
 */
function getSubjectTabLinks(doc) {
    const tabs = [];
    doc.querySelectorAll('.seigo-tab-item').forEach((item, idx) => {
        const a = item.querySelector('a');
        const isActive = item.classList.contains('active');
        const href = a ? a.href : null;
        const text = a ? a.textContent.trim() : "";
        tabs.push({ text, href, isActive, idx });
    });
    return tabs;
}

// ============================================================
// 統合スクレイピング（v3 メインアクション）
// ============================================================

async function handleUnifiedScrape() {
    const logs = [];
    logs.push("[START] 統合スクレイピング開始 (v3)");
    logs.push(`[INFO] URL: ${window.location.href}`);
    logs.push(`[INFO] bodyId: ${document.body?.id || '(none)'}`);

    // DOM要素診断
    const hasQuestionTable = !!document.querySelector('.seigo-anser-guide_table');
    const hasSyukeiWrap    = !!document.querySelector('.syukei-wrap');
    const hasSubTabErrata  = !!document.querySelector('.side-tab_viewErrata a');
    const hasSubTabResults = !!document.querySelector('.side-tab_viewResults a');
    const hasSubjectTabs   = document.querySelectorAll('.seigo-tab-item').length;
    logs.push(`[DOM] 問題テーブル=${hasQuestionTable}, 集計wrap=${hasSyukeiWrap}, 正誤タブ=${hasSubTabErrata}, 成績タブ=${hasSubTabResults}, 教科タブ=${hasSubjectTabs}`);

    let subjectsData = [];
    let summaryData  = null;
    let testName     = null;
    let examDate     = null;
    let testDateRaw  = null;

    // テスト名と日付は現在のページから取得
    const testNameEl = document.querySelector('h1.headingBox-main');
    const testDateEl = document.querySelector('.date-text');
    if (testNameEl) testName = testNameEl.innerText.trim();
    if (testDateEl) {
        testDateRaw = testDateEl.innerText.trim();
        examDate = parseExamDate(testDateRaw);
    }
    logs.push(`[INFO] テスト名: ${testName || '(不明)'}, 日付: ${testDateRaw || '(不明)'}`);

    // サブタブURLを取得
    const subTabUrls = getSubTabUrls(document);
    logs.push(`[INFO] 正誤一覧URL: ${subTabUrls.errataUrl || '(なし)'}`);
    logs.push(`[INFO] 成績URL: ${subTabUrls.resultsUrl || '(なし)'}`);

    const isLocalFile = window.location.protocol === 'file:';

    // ====================================================
    // STEP 1: 問題別データ（正誤一覧）の取得
    // ====================================================

    // (1a) 現在のページに問題テーブルがあるか試行
    if (hasQuestionTable) {
        logs.push("[STEP1] 現在ページに問題テーブルあり。直接スクレイプ。");
        try {
            subjectsData = await scrapeAllSubjectsFromDoc(document, logs);
        } catch (e) {
            logs.push(`[ERROR] 現在ページのスクレイプ失敗: ${e.message}`);
        }
    }

    // (1b) 現在ページに問題テーブルがない場合、正誤一覧サブタブからfetch
    if (subjectsData.length === 0 && subTabUrls.errataUrl && !isLocalFile) {
        logs.push("[STEP1] 正誤一覧サブタブURLからfetchで取得");
        try {
            subjectsData = await fetchAndScrapeErrata(subTabUrls.errataUrl, logs);
        } catch (e) {
            logs.push(`[ERROR] 正誤一覧のfetch取得失敗: ${e.message}`);
        }
    }

    // (1c) それでも取れない場合、教科タブのリンクがexam-typeページなら試行
    if (subjectsData.length === 0 && !isLocalFile) {
        const subjectTabs = getSubjectTabLinks(document);
        const examTypeLinks = subjectTabs.filter(t => t.href && t.href.includes('exam-type'));
        if (examTypeLinks.length > 0) {
            logs.push(`[STEP1] 教科タブにexam-typeリンクが${examTypeLinks.length}件あり。fetchで取得`);
            for (const tab of examTypeLinks) {
                try {
                    const data = await fetchAndScrapeOnePage(tab.href, logs, tab.text);
                    if (data && data.questions.length > 0) {
                        subjectsData.push(data);
                    }
                } catch (e) {
                    logs.push(`[ERROR] ${tab.text}: ${e.message}`);
                }
            }
        }
    }

    // ====================================================
    // STEP 2: 成績集計データの取得
    // ====================================================

    // (2a) 現在ページが成績集計ページかもしれない
    if (hasSyukeiWrap) {
        try {
            summaryData = scrapeSummaryFromDoc(document);
            logs.push(`[OK] 現在ページから成績集計取得: ${summaryData.examType}`);
        } catch (e) {
            logs.push(`[INFO] 現在ページの成績集計パース失敗: ${e.message}`);
        }
    }

    // (2b) 成績サブタブURLからfetch
    if (!summaryData && subTabUrls.resultsUrl && !isLocalFile) {
        logs.push(`[STEP2] 成績サブタブURLからfetch: ${subTabUrls.resultsUrl}`);
        try {
            const response = await fetchWithTimeout(subTabUrls.resultsUrl, { credentials: "include" });
            logs.push(`[FETCH] 成績 レスポンス: status=${response.status}`);
            if (response.ok) {
                const htmlText = await response.text();
                const doc = new DOMParser().parseFromString(htmlText, "text/html");
                const bodyId = doc.body ? doc.body.id : '';
                logs.push(`[PARSE] 成績HTML: ${htmlText.length}文字, bodyId="${bodyId}"`);
                summaryData = scrapeSummaryFromDocAuto(doc, bodyId);
                logs.push(`[OK] 成績集計データ取得成功: ${summaryData.examType}`);
                if (!testName && summaryData.testName) testName = summaryData.testName;
                if (!examDate && summaryData.examDate) {
                    examDate = summaryData.examDate;
                    testDateRaw = summaryData.attentionDayRaw;
                }
            } else {
                logs.push(`[WARN] 成績ページHTTPエラー: ${response.status}`);
            }
        } catch (e) {
            logs.push(`[WARN] 成績ページfetch失敗: ${e.message}`);
        }
    }

    // ====================================================
    // 結果判定（厳格）
    // ====================================================
    const totalQuestions = subjectsData.reduce((sum, d) => sum + d.questions.length, 0);

    if (subjectsData.length === 0 && !summaryData) {
        logs.push("[ERROR] 問題別データも成績集計データも取得できませんでした");
        return {
            success: false,
            error: "テスト結果ページを開いてから実行してください。正誤一覧・成績サブタブが見つかりませんでした。",
            logs
        };
    }

    if (subjectsData.length > 0 && totalQuestions === 0) {
        logs.push("[ERROR] 教科データはあるが問題データ（正誤・単元情報）が0件です");
        return {
            success: false,
            error: "問題データ（正誤一覧・単元情報）を取得できませんでした。正誤一覧テーブルのあるページで実行してください。",
            logs
        };
    }

    const unified = buildUnifiedJson(testName, examDate, testDateRaw, subjectsData, summaryData);
    logs.push(`[DONE] 統合データ構築完了: 教科数=${unified.subjects.length}, 問題総数=${totalQuestions}, 成績集計=${unified.summary ? 'あり' : 'なし'}`);

    return { success: true, data: unified, logs };
}

// ============================================================
// 正誤一覧ページをfetchで取得し、全教科をスクレイプ
// ============================================================

async function fetchAndScrapeErrata(errataUrl, logs) {
    logs.push(`[FETCH] 正誤一覧ページ取得: ${errataUrl}`);
    const response = await fetchWithTimeout(errataUrl, { credentials: "include" });
    logs.push(`[FETCH] 正誤一覧 レスポンス: status=${response.status}`);

    if (!response.ok) {
        throw new Error(`HTTPエラー: ${response.status}`);
    }

    const htmlText = await response.text();
    const doc = new DOMParser().parseFromString(htmlText, "text/html");
    logs.push(`[PARSE] 正誤一覧HTML: ${htmlText.length}文字`);

    // このページから全教科を取得
    return await scrapeAllSubjectsFromDoc(doc, logs);
}

// ============================================================
// 1つの正誤一覧ページ（exam-type）をfetchしてスクレイプ
// ============================================================

async function fetchAndScrapeOnePage(url, logs, label) {
    logs.push(`[FETCH] ${label}: ${url}`);
    const response = await fetchWithTimeout(url, { credentials: "include" });
    if (!response.ok) {
        logs.push(`[ERROR] ${label} HTTPエラー: ${response.status}`);
        return null;
    }
    const htmlText = await response.text();
    const doc = new DOMParser().parseFromString(htmlText, "text/html");
    try {
        const data = scrapeDataFromDoc(doc);
        logs.push(`[OK] ${label}: 問題数=${data.questions.length}`);
        return data;
    } catch (e) {
        logs.push(`[WARN] ${label} パース失敗: ${e.message}`);
        return null;
    }
}

// ============================================================
// ドキュメントから全教科の問題別データを取得
// （現在ページ + 他教科タブをfetch）
// ============================================================

async function scrapeAllSubjectsFromDoc(doc, logs) {
    let currentData;
    try {
        currentData = scrapeDataFromDoc(doc);
        logs.push(`[OK] 教科=${currentData.subject}, 問題数=${currentData.questions.length}`);
    } catch (e) {
        logs.push(`[SKIP] ドキュメントから問題別データ取得不可: ${e.message}`);
        return [];
    }

    const results = [currentData];

    // 他教科タブ
    const tabLinks = [];
    doc.querySelectorAll('.seigo-tab-item').forEach((item, idx) => {
        const a = item.querySelector('a');
        const isActive = item.classList.contains('active');
        const text = a ? a.textContent.trim() : "";
        const href = a ? a.href : null;
        logs.push(`[TAB ${idx}] text="${text}", active=${isActive}`);
        if (a && !isActive && href) tabLinks.push({ text, href });
    });

    if (tabLinks.length === 0 || window.location.protocol === 'file:') {
        return results;
    }

    for (const tab of tabLinks) {
        try {
            const data = await fetchAndScrapeOnePage(tab.href, logs, tab.text);
            if (data && data.questions.length > 0) {
                results.push(data);
            }
        } catch (e) {
            logs.push(`[ERROR] ${tab.text}: ${e.message}`);
        }
    }

    logs.push(`[INFO] 合計 ${results.length} 教科取得`);
    return results;
}

// ============================================================
// 問題別データのスクレイピング（単一ドキュメント）
// ============================================================

function scrapeDataFromDoc(doc) {
    const testNameEl      = doc.querySelector('h1.headingBox-main');
    const testDateEl      = doc.querySelector('.date-text');
    const activeSubjectEl = doc.querySelector('.seigo-tab-item.active a');

    if (!testNameEl || !testDateEl || !activeSubjectEl) {
        throw new Error("テスト結果の必須要素が見つかりません（テスト名/日付/教科タブ）");
    }

    const testName    = testNameEl.innerText.trim();
    const testDateRaw = testDateEl.innerText.trim();
    const subject     = activeSubjectEl.innerText.trim();
    const parsedDate  = parseExamDate(testDateRaw);
    const testId      = `${parsedDate.isoDate || testDateRaw}_${testName}_${subject}`.replace(/\s+/g, '_');

    const score         = toNumber(doc.querySelector('.point-text'));
    const scoreRaw      = doc.querySelector('.point-text')?.innerText.trim() ?? null;
    const answerSummary = doc.querySelector('.answer-text')?.innerText.trim() ?? null;

    const questions = [];
    doc.querySelectorAll('.seigo-anser-guide_table tbody tr').forEach(row => {
        const tds = row.querySelectorAll('td');
        if (tds.length < 7) return;

        const rawUnit    = tds[1].innerText.trim();
        const resultRaw  = tds[2].innerText.trim();
        const parsed     = parseCategory(rawUnit);
        const correctAnswer = tds[3] ? tds[3].innerText.trim() : "";

        questions.push({
            number:        tds[0].innerText.trim(),
            rawUnit,
            category:      parsed.category,
            subCategory:   parsed.subCategory,
            result:        resultRaw === "" ? "未掲載" : resultRaw,
            correctAnswer,
            correctRate:   parseInt(tds[4].innerText.trim(), 10) || 0,
            incorrectRate: parseInt(tds[5].innerText.trim(), 10) || 0,
            noAnswerRate:  parseInt(tds[6].innerText.trim(), 10) || 0
        });
    });

    return {
        testId, testName, testDateRaw,
        examDate: parsedDate,
        subject, score, scoreRaw, answerSummary,
        questions,
        extractedAt: new Date().toISOString()
    };
}

// ============================================================
// 統合JSONオブジェクトの構築
// ============================================================

function buildUnifiedJson(testName, examDate, testDateRaw, subjectsData, summaryData) {
    const subjects = subjectsData.map(d => ({
        subject: d.subject,
        score: d.score,
        scoreRaw: d.scoreRaw,
        answerSummary: d.answerSummary,
        questions: d.questions
    }));

    let summary = null;
    if (summaryData) {
        summary = {
            examType: summaryData.examType,
            basicSummary: summaryData.basicSummary || [],
            rankings: summaryData.rankings || []
        };
        if (summaryData.examTypeSummary) summary.examTypeSummary = summaryData.examTypeSummary;
        if (summaryData.examTypeRankings) summary.examTypeRankings = summaryData.examTypeRankings;
    }

    return {
        version: "3.0",
        extractedAt: new Date().toISOString(),
        testName: testName || "不明",
        testDateRaw: testDateRaw || "",
        examDate: examDate || {},
        subjects,
        summary
    };
}

// ============================================================
// 成績集計ページ スクレイピング
// ============================================================

function scrapeSummaryFromDoc(doc) {
    const bodyId = doc.body ? doc.body.id : '';
    const url = (typeof window !== 'undefined') ? window.location.href : '';

    if (bodyId === 'ER_G' || url.includes('examination-public-trial')) {
        return scrapePublicExamSummary(doc);
    }
    if (bodyId === 'ER_A' || url.includes('training-examination') || doc.querySelector('.syukei-wrap')) {
        return scrapeTrainingExamSummary(doc);
    }
    throw new Error("成績集計ページではありません");
}

function scrapeSummaryFromDocAuto(doc, bodyId) {
    if (bodyId === 'ER_G') return scrapePublicExamSummary(doc);
    if (bodyId === 'ER_A') return scrapeTrainingExamSummary(doc);
    if (doc.querySelector('.syukei-typeComprehensive_table-4c')) return scrapePublicExamSummary(doc);
    if (doc.querySelector('.syukei-wrap')) return scrapeTrainingExamSummary(doc);
    throw new Error("成績集計ページの種別を判定できません");
}

function scrapeTrainingExamSummary(doc) {
    const attentionDayEl = doc.querySelector('.attention_day');
    if (!attentionDayEl) throw new Error("実施日情報が見つかりません");

    const attentionDayRaw = attentionDayEl.innerText.trim();
    const parsedDate = parseExamDate(attentionDayRaw);
    const testNameEl = doc.querySelector('h1.headingBox-main');
    const testName = testNameEl ? testNameEl.innerText.trim() : "学習力育成テスト成績";

    const syukeiSection = doc.querySelector('.syukei-wrap');
    const basicSummary = [];
    const rankings = [];

    if (syukeiSection) {
        const tables = syukeiSection.querySelectorAll('.syukei_table table');
        if (tables[0]) {
            tables[0].querySelectorAll('tbody tr').forEach(row => {
                const th = row.querySelector('th');
                const tds = row.querySelectorAll('td');
                if (!th || tds.length < 5) return;
                basicSummary.push({
                    label: th.innerText.trim(),
                    kyotsu: toNumber(tds[0]), oyo: toNumber(tds[1]),
                    total: toNumber(tds[2]), avg: toNumber(tds[3]), eval: toNumber(tds[4])
                });
            });
        }
        rankings.push(...extractRankings(tables[1]));
    }

    const examTypeSection = doc.querySelector('.syukei-examinationType-wrap');
    const examTypeSummary = [];
    const examTypeRankings = [];

    if (examTypeSection) {
        const tables = examTypeSection.querySelectorAll('.syukei-examinationType_table table');
        if (tables[0]) {
            tables[0].querySelectorAll('tbody tr').forEach(row => {
                const th = row.querySelector('th');
                const tds = row.querySelectorAll('td');
                if (!th || tds.length < 5) return;
                examTypeSummary.push({
                    label: th.innerText.trim(),
                    kyotsu: toNumber(tds[0]), sentaku: toNumber(tds[1]),
                    total: toNumber(tds[2]), avg: toNumber(tds[3]), eval: toNumber(tds[4])
                });
            });
        }
        examTypeRankings.push(...extractRankings(tables[1]));
    }

    return {
        examType: "training", testName, attentionDayRaw,
        examDate: parsedDate, basicSummary, rankings,
        examTypeSummary, examTypeRankings,
        extractedAt: new Date().toISOString()
    };
}

function scrapePublicExamSummary(doc) {
    const attentionDayEl = doc.querySelector('.attention_day');
    if (!attentionDayEl) throw new Error("実施日情報が見つかりません");

    const attentionDayRaw = attentionDayEl.innerText.trim();
    const parsedDate = parseExamDate(attentionDayRaw);
    const testNameEl = doc.querySelector('h1.headingBox-main');
    const testName = testNameEl ? testNameEl.innerText.trim() : "全国公開模試成績";

    const syukeiSection = doc.querySelector('.syukei-wrap');
    const basicSummary = [];
    const rankings = [];

    if (syukeiSection) {
        const scoreTable = syukeiSection.querySelector('.syukei-typeComprehensive_table-4c table');
        if (scoreTable) {
            scoreTable.querySelectorAll('tbody tr').forEach(row => {
                const th = row.querySelector('th');
                const tds = row.querySelectorAll('td');
                if (!th || tds.length < 3) return;
                basicSummary.push({
                    label: th.innerText.trim(),
                    score: toNumber(tds[0]), avg: toNumber(tds[1]), hensa: toNumber(tds[2])
                });
            });
        }
        const rankTable = syukeiSection.querySelector('.syukei_table table');
        rankings.push(...extractRankings(rankTable));
    }

    return {
        examType: "public", testName, attentionDayRaw,
        examDate: parsedDate, basicSummary, rankings,
        extractedAt: new Date().toISOString()
    };
}

// ============================================================
// 分野別正答率 スクレイピング
// ============================================================

function extractTableGrid(tableElement) {
    const rows = Array.from(tableElement.querySelectorAll('tr'));
    const grid = [];
    
    rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        let colIndex = 0;
        
        cells.forEach(cell => {
            while (grid[rowIndex] && grid[rowIndex][colIndex]) {
                colIndex++;
            }
            
            const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10);
            const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
            
            for (let r = 0; r < rowspan; r++) {
                for (let c = 0; c < colspan; c++) {
                    if (!grid[rowIndex + r]) {
                        grid[rowIndex + r] = [];
                    }
                    grid[rowIndex + r][colIndex + c] = {
                        cell: cell,
                        isOriginal: (r === 0 && c === 0),
                        tagName: cell.tagName.toLowerCase(),
                        text: cell.innerText.trim()
                    };
                }
            }
        });
    });
    return grid;
}

function scrapeFieldAccuracyRate(doc) {
    const subjectRadio = doc.querySelector('input[name="subject_v"]:checked');
    const gradeRadio = doc.querySelector('input[name="grade_v"]:checked');
    const termRadio = doc.querySelector('input[name="term_v"]:checked');
    const testKndRadio = doc.querySelector('input[name="test_knds_v"]:checked');
    const bracketsEl = doc.querySelector('.heading-brackets');
    
    const searchCondition = {
        subject: subjectRadio ? subjectRadio.nextElementSibling.innerText.trim() : null,
        subjectCode: subjectRadio ? subjectRadio.value : null,
        grade: gradeRadio ? parseInt(gradeRadio.value, 10) : null,
        term: termRadio ? termRadio.nextElementSibling.innerText.trim() : null,
        termCode: termRadio ? termRadio.value : null,
        testType: testKndRadio ? testKndRadio.nextElementSibling.innerText.trim() : null,
        testTypeCode: testKndRadio ? testKndRadio.value : null,
        bracketsText: bracketsEl ? bracketsEl.innerText.trim() : null
    };

    const tbody = doc.querySelector('.CorrectAnswerRate_table tbody');
    if (!tbody) throw new Error("正答率テーブルが見つかりません");

    const fields = [];
    const grid = extractTableGrid(tbody);

    grid.forEach((rowCells) => {
        // [0,1,2] Category, [3,4] Star1, [5,6] Star2, [7,8] Star3, [9,10] Overall
        if (!rowCells[4] || rowCells[4].tagName !== 'td') return;

        const extractRateData = (linkCol, valCol) => {
            const cellData = rowCells[valCol];
            if (!cellData || cellData.text === "") return null;
            
            const text = cellData.text;
            const m = text.match(/(\d+)%\((\d+)\/(\d+)\)/);
            if (!m) return null; // 例: 0%(0/0) や文字列など想定外の場合
            
            const detailLink = rowCells[linkCol]?.cell?.querySelector('a');
            let detailUrl = detailLink ? detailLink.href : null;
            let categoryCode = null;
            
            if (detailUrl) {
                try {
                    const urlObj = new URL(detailUrl, window.location.origin);
                    categoryCode = urlObj.searchParams.get('category_code');
                } catch(e) {}
            }
            
            return {
                rate: parseInt(m[1], 10),
                correct: parseInt(m[2], 10),
                total: parseInt(m[3], 10),
                detailUrl,
                categoryCode
            };
        };

        const category1 = rowCells[0] ? rowCells[0].text : null;
        let category2 = null;
        let category3 = null;
        
        if (rowCells[1] && rowCells[1].cell !== rowCells[0].cell) {
            category2 = rowCells[1].text;
        }
        if (rowCells[2] && rowCells[2].cell !== rowCells[1].cell && rowCells[2].cell !== rowCells[0].cell) {
            category3 = rowCells[2].text;
        }

        const star1 = extractRateData(3, 4);
        const star2 = extractRateData(5, 6);
        const star3 = extractRateData(7, 8);
        const overall = extractRateData(9, 10);

        // すべてnullならスキップ（空行など）
        if (!star1 && !star2 && !star3 && !overall) return;

        const categoryCode = star1?.categoryCode || star2?.categoryCode || star3?.categoryCode || overall?.categoryCode || null;

        fields.push({
            category1,
            category2,
            category3,
            categoryCode,
            difficulty: { star1, star2, star3, overall }
        });
    });

    return {
        version: "3.0",
        dataType: "fieldAccuracyRate",
        extractedAt: new Date().toISOString(),
        searchCondition,
        fields
    };
}

// ============================================================
// 分野別正答率 — 全組み合わせ自動取得
// ============================================================

function getEnabledRadioValues(doc, name) {
    return Array.from(doc.querySelectorAll(`input[type="radio"][name="${name}"]`))
        .filter(el => !el.disabled)
        .map(el => el.value);
}

function buildFormCombinations(doc) {
    const subjects  = getEnabledRadioValues(doc, 'subject_v');
    const grades    = getEnabledRadioValues(doc, 'grade_v');
    const terms     = getEnabledRadioValues(doc, 'term_v');
    const testKinds = getEnabledRadioValues(doc, 'test_knds_v');

    const hiddenParams = {};
    doc.querySelectorAll('form[name="selectExam"] input[type="hidden"]').forEach(el => {
        hiddenParams[el.name] = el.value;
    });

    const combinations = [];
    for (const s of subjects)
        for (const g of grades)
            for (const t of terms)
                for (const k of testKinds)
                    combinations.push({ subject_v: s, grade_v: g, term_v: t, test_knds_v: k });

    return { combinations, hiddenParams };
}

// フォームを指定コンボで送信してページ遷移させる
function _submitFormWithCombo(combo) {
    const formEl = document.querySelector('form[name="selectExam"]');
    if (!formEl) return;
    for (const [name, value] of Object.entries(combo)) {
        const radio = document.querySelector(`input[type="radio"][name="${name}"][value="${value}"]`);
        if (radio) radio.checked = true;
    }
    const submitBtn = formEl.querySelector('button[type="submit"], input[type="submit"]');
    if (submitBtn) submitBtn.click();
    else formEl.submit();
}

// ============================================================
// Bookend 画像ダウンロード
// ============================================================

async function downloadBookendImagesFlow() {
    const canvas = document.querySelector('canvas#canvas');
    if (!canvas) {
        throw new Error("Canvasが見つかりません。Bookendビューアが完全に読み込まれるまでお待ちください。");
    }

    let images = [];
    let maxRetries = 50; // 安全のための最大ページ数
    
    // スリープ関数
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    
    // ページ送りのための右矢印キーイベントを発火する関数
    const pressRight = () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true }));
    };

    alert("画像のダウンロードを開始します。\n途中で他のタブを開いたり、ウィンドウを最小化しないでください。");

    for (let i = 0; i < maxRetries; i++) {
        const dataURL = canvas.toDataURL('image/png');
        if (images.includes(dataURL)) {
            // 画像が前回と完全に一致した場合、最後のページに到達したとみなす
            break;
        }
        images.push(dataURL);
        
        // ファイル名にゼロパディングをつける（page_01.png等）
        const pageNum = String(images.length).padStart(2, '0');
        const filename = `page_${pageNum}.png`;
        
        // リンク要素を生成してダウンロードを発火
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataURL;
        link.click();
        
        // 次のページへ
        pressRight();
        // 描画が完了するまで待機（環境に応じて調整が必要な場合があります）
        await sleep(1500); 
    }

    alert(`ダウンロードが完了しました（全${images.length}ページ）。\n※最初のページから実行しなかった場合、一部のみダウンロードされている可能性があります。`);
}

// ページリロードをまたいで収集を継続する（auto-runから呼ばれる）
async function _continueCollection(state) {
    const { combinations, index, results } = state;
    const newResults = [...results];

    if (document.querySelector('.CorrectAnswerRate_table')) {
        try {
            newResults.push(scrapeFieldAccuracyRate(document));
        } catch (e) {}
    }

    const nextIndex = index + 1;

    if (nextIndex < combinations.length) {
        await chrome.storage.local.set({
            nichinokenCollection: { ...state, index: nextIndex, results: newResults }
        });
        _submitFormWithCombo(combinations[nextIndex]);
    } else {
        await chrome.storage.local.set({
            nichinokenCollection: { status: 'done', results: newResults, total: combinations.length }
        });
    }
}

// ============================================================
// ページロード時に収集が進行中なら自動継続
// ============================================================
(async () => {
    try {
        const { nichinokenCollection } = await chrome.storage.local.get('nichinokenCollection');
        if (nichinokenCollection?.status === 'collecting') {
            await _continueCollection(nichinokenCollection);
        }
    } catch (e) {}
})();
