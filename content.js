// ============================================================
// メッセージハンドラ
// ============================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scrapeTestData") {
        handleScrapeRequest().then(result => {
            sendResponse(result);
        }).catch(error => {
            sendResponse({ success: false, error: error.message, logs: [`[FATAL] ${error.message}`] });
        });
        return true;
    }
    if (request.action === "scrapeSummaryData") {
        try {
            const result = scrapeSummaryFromDoc(document);
            sendResponse({ success: true, data: result });
        } catch (e) {
            sendResponse({ success: false, error: e.message });
        }
        return true;
    }
});

// ============================================================
// 共通ユーティリティ
// ============================================================

/**
 * 日付文字列をパース
 * 対応フォーマット:
 *   "4年生　2026年3月21日実施"                  (学習力育成テスト)
 *   "4年生　第1回　2026年2月28日実施"            (全国公開模試)
 */
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

/**
 * 単元名を大分類・小分類に分割
 * 区切り文字: 全角ダッシュ、セミコロン、全角コロン、半角ハイフン
 */
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

/** 数値テキストを安全に数値へ変換 */
function toNumber(el) {
    const t = el ? el.innerText.trim() : '';
    if (t === '') return null;
    const m = t.match(/[\d.]+/);
    return m ? parseFloat(m[0]) : null;
}

/** 順位テーブル (総合順位・男女別順位) の共通パーサー */
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
// 問題別回答結果ページ (exam-type1 / exam-type11)
// ============================================================

async function handleScrapeRequest() {
    const logs = [];
    logs.push("[START] handleScrapeRequest 開始");

    let currentData;
    try {
        currentData = scrapeDataFromDoc(document);
        logs.push(`[OK] 現在ページ取得成功: 教科=${currentData.subject}, 問題数=${currentData.questions.length}`);
    } catch (e) {
        logs.push(`[ERROR] 現在ページのスクレイピング失敗: ${e.message}`);
        return { success: false, data: [], logs };
    }

    const results = [currentData];

    // 他教科タブのリンクを収集
    const allTabItems = document.querySelectorAll('.seigo-tab-item');
    logs.push(`[INFO] 教科タブ要素数: ${allTabItems.length}`);

    const tabLinks = [];
    allTabItems.forEach((item, idx) => {
        const a        = item.querySelector('a');
        const isActive = item.classList.contains('active');
        const href     = a ? a.href : "(リンクなし)";
        const text     = a ? a.textContent.trim() : "(テキストなし)";
        logs.push(`[TAB ${idx}] text="${text}", href="${href}", active=${isActive}`);
        if (a && !isActive) tabLinks.push({ text, href });
    });

    if (tabLinks.length === 0) {
        logs.push("[WARN] 非アクティブなタブが見つかりませんでした。現在ページのみ返します。");
        return { success: true, data: results, logs };
    }

    if (window.location.protocol === 'file:') {
        logs.push("[SKIP] ローカルファイルのため他教科の自動取得をスキップ");
        return { success: true, data: results, logs };
    }

    // 非同期で他タブのデータを取得
    for (const tab of tabLinks) {
        logs.push(`[FETCH] ${tab.text} の取得開始: ${tab.href}`);
        try {
            const response = await fetch(tab.href, { credentials: "include" });
            logs.push(`[FETCH] ${tab.text} レスポンス: status=${response.status}`);
            if (!response.ok) {
                logs.push(`[ERROR] ${tab.text} HTTPエラー: ${response.status} ${response.statusText}`);
                continue;
            }

            const htmlText = await response.text();
            const doc      = new DOMParser().parseFromString(htmlText, "text/html");

            const activeTabEl = doc.querySelector('.seigo-tab-item.active a');
            if (!activeTabEl) {
                const title = doc.querySelector('title');
                logs.push(`[WARN] ${tab.text}: アクティブタブなし。タイトル="${title ? title.textContent : '(なし)'}"`); 
                continue;
            }
            logs.push(`[PARSE] ${tab.text} アクティブ教科: "${activeTabEl.textContent.trim()}"`);

            const parsedData = scrapeDataFromDoc(doc);
            logs.push(`[OK] ${tab.text} パース成功: 問題数=${parsedData.questions.length}`);
            results.push(parsedData);
        } catch (e) {
            logs.push(`[ERROR] ${tab.text} の取得/パースに失敗: ${e.message}`);
        }
    }

    logs.push(`[DONE] 合計 ${results.length} 教科分を返します`);
    return { success: true, data: results, logs };
}

function scrapeDataFromDoc(doc) {
    const testNameEl      = doc.querySelector('h1.headingBox-main');
    const testDateEl      = doc.querySelector('.date-text');
    const activeSubjectEl = doc.querySelector('.seigo-tab-item.active a');

    if (!testNameEl || !testDateEl || !activeSubjectEl) {
        throw new Error("テスト結果情報が見つかりません（テスト名・日付またはアクティブ教科タブが不明）。");
    }

    const testName    = testNameEl.innerText.trim();
    const testDateRaw = testDateEl.innerText.trim();
    const subject     = activeSubjectEl.innerText.trim();
    const parsedDate  = parseExamDate(testDateRaw);
    const testId      = `${parsedDate.isoDate || testDateRaw}_${testName}_${subject}`.replace(/\s+/g, '_');

    const score         = toNumber(doc.querySelector('.point-text'));
    const answerSummary = doc.querySelector('.answer-text')?.innerText.trim() ?? null;

    const questions = [];
    doc.querySelectorAll('.seigo-anser-guide_table tbody tr').forEach(row => {
        const tds = row.querySelectorAll('td');
        if (tds.length < 7) return;

        const rawUnit    = tds[1].innerText.trim();
        const resultRaw  = tds[2].innerText.trim();
        const parsed     = parseCategory(rawUnit);

        questions.push({
            number:        tds[0].innerText.trim(),
            rawUnit,
            category:      parsed.category,
            subCategory:   parsed.subCategory,
            result:        resultRaw === "" ? "未掲載" : resultRaw,
            correctRate:   parseInt(tds[4].innerText.trim(), 10) || 0,
            incorrectRate: parseInt(tds[5].innerText.trim(), 10) || 0,
            noAnswerRate:  parseInt(tds[6].innerText.trim(), 10) || 0
        });
    });

    return {
        testId,
        testName,
        testDateRaw,
        examDate: parsedDate,
        subject,
        score,
        answerSummary,
        questions,
        extractedAt: new Date().toISOString()
    };
}

// ============================================================
// 成績集計ページ (record-detail.html) — 統合ディスパッチャ
// ============================================================

/**
 * body id または URL でページ種別を判定し、適切なパーサーに委譲
 *   ER_A / training-examination → 学習力育成テスト
 *   ER_G / examination-public-trial → 全国公開模試
 */
function scrapeSummaryFromDoc(doc) {
    const bodyId = doc.body ? doc.body.id : '';
    const url    = (typeof window !== 'undefined') ? window.location.href : '';

    if (bodyId === 'ER_G' || url.includes('examination-public-trial')) {
        return scrapePublicExamSummary(doc);
    }
    if (bodyId === 'ER_A' || url.includes('training-examination') || doc.querySelector('.syukei-wrap')) {
        return scrapeTrainingExamSummary(doc);
    }
    throw new Error("対応している成績集計ページが見つかりません。");
}

// ============================================================
// 学習力育成テスト 成績集計
// ============================================================

function scrapeTrainingExamSummary(doc) {
    const attentionDayEl = doc.querySelector('.attention_day');
    if (!attentionDayEl) throw new Error("実施日情報(.attention_day)が見つかりません。");

    const attentionDayRaw = attentionDayEl.innerText.trim();
    const parsedDate      = parseExamDate(attentionDayRaw);
    const testNameEl      = doc.querySelector('h1.headingBox-main');
    const testName        = testNameEl ? testNameEl.innerText.trim() : "学習力育成テスト成績";
    const summaryId       = `${parsedDate.isoDate || attentionDayRaw}_training`.replace(/\s+/g, '_');

    // ---- 基本集計（共通/応用/合計/平均点/評価）----
    const syukeiSection = doc.querySelector('.syukei-wrap');
    const basicSummary  = [];
    const rankings      = [];

    if (syukeiSection) {
        const tables = syukeiSection.querySelectorAll('.syukei_table table');

        if (tables[0]) {
            tables[0].querySelectorAll('tbody tr').forEach(row => {
                const th  = row.querySelector('th');
                const tds = row.querySelectorAll('td');
                if (!th || tds.length < 5) return;
                basicSummary.push({
                    label:  th.innerText.trim(),
                    kyotsu: toNumber(tds[0]),
                    oyo:    toNumber(tds[1]),
                    total:  toNumber(tds[2]),
                    avg:    toNumber(tds[3]),
                    eval:   toNumber(tds[4])
                });
            });
        }
        rankings.push(...extractRankings(tables[1]));
    }

    // ---- 受験種別集計（基礎・応用別 得点/平均点/評価 + 順位）----
    const examTypeSection    = doc.querySelector('.syukei-examinationType-wrap');
    const examTypeSummary    = [];
    const examTypeRankings   = [];

    if (examTypeSection) {
        const tables = examTypeSection.querySelectorAll('.syukei-examinationType_table table');

        if (tables[0]) {
            tables[0].querySelectorAll('tbody tr').forEach(row => {
                const th  = row.querySelector('th');
                const tds = row.querySelectorAll('td');
                if (!th || tds.length < 5) return;
                examTypeSummary.push({
                    label:   th.innerText.trim(),
                    kyotsu:  toNumber(tds[0]),
                    sentaku: toNumber(tds[1]),
                    total:   toNumber(tds[2]),
                    avg:     toNumber(tds[3]),
                    eval:    toNumber(tds[4])
                });
            });
        }
        examTypeRankings.push(...extractRankings(tables[1]));
    }

    return {
        summaryId,
        examType: "training",          // 学習力育成テスト
        testName,
        attentionDayRaw,
        examDate: parsedDate,
        basicSummary,                  // 共通/応用/合計/平均点/評価
        rankings,                      // 総合順位・男女別順位
        examTypeSummary,               // 受験種別（基礎・応用別）
        examTypeRankings,
        extractedAt: new Date().toISOString()
    };
}

// ============================================================
// 全国公開模試 成績集計
// ============================================================

function scrapePublicExamSummary(doc) {
    const attentionDayEl = doc.querySelector('.attention_day');
    if (!attentionDayEl) throw new Error("実施日情報(.attention_day)が見つかりません。");

    const attentionDayRaw = attentionDayEl.innerText.trim();
    const parsedDate      = parseExamDate(attentionDayRaw);
    const testNameEl      = doc.querySelector('h1.headingBox-main');
    const testName        = testNameEl ? testNameEl.innerText.trim() : "全国公開模試成績";
    const roundStr        = parsedDate.round ? `_R${parsedDate.round}` : '';
    const summaryId       = `${parsedDate.isoDate || attentionDayRaw}_public${roundStr}`.replace(/\s+/g, '_');

    // ---- 集計（得点/平均点/偏差値）----
    const syukeiSection = doc.querySelector('.syukei-wrap');
    const basicSummary  = [];
    const rankings      = [];

    if (syukeiSection) {
        // 全国公開模試は syukei-typeComprehensive_table-4c クラスに得点テーブルがある
        const scoreTable = syukeiSection.querySelector('.syukei-typeComprehensive_table-4c table');
        if (scoreTable) {
            scoreTable.querySelectorAll('tbody tr').forEach(row => {
                const th  = row.querySelector('th');
                const tds = row.querySelectorAll('td');
                if (!th || tds.length < 3) return;
                basicSummary.push({
                    label: th.innerText.trim(),
                    score: toNumber(tds[0]),   // 得点
                    avg:   toNumber(tds[1]),   // 平均点
                    hensa: toNumber(tds[2])    // 偏差値
                });
            });
        }

        // 順位テーブルは syukei_table クラス
        const rankTable = syukeiSection.querySelector('.syukei_table table');
        rankings.push(...extractRankings(rankTable));
    }

    // 注: 偏差値分布表(bunpu-hyou-wrap)はCanvasグラフのためデータ取得不可

    return {
        summaryId,
        examType: "public",            // 全国公開模試
        testName,
        attentionDayRaw,
        examDate: parsedDate,
        basicSummary,                  // 得点/平均点/偏差値
        rankings,                      // 総合順位・男女別順位
        extractedAt: new Date().toISOString()
    };
}
