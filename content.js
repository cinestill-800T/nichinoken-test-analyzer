chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scrapeTestData") {
        handleScrapeRequest().then(result => {
            sendResponse(result);
        }).catch(error => {
            sendResponse({ success: false, error: error.message, logs: [`[FATAL] ${error.message}`] });
        });
        return true;
    }
});

async function handleScrapeRequest() {
    const logs = [];
    logs.push("[START] handleScrapeRequest 開始");

    // 1. 現在のページのデータをスクレイピング
    let currentData;
    try {
        currentData = scrapeDataFromDoc(document);
        logs.push(`[OK] 現在ページ取得成功: 教科=${currentData.subject}, 問題数=${currentData.questions.length}`);
    } catch (e) {
        logs.push(`[ERROR] 現在ページのスクレイピング失敗: ${e.message}`);
        return { success: false, data: [], logs };
    }

    const results = [currentData];

    // 2. 他教科のタブリンクを取得
    const allTabItems = document.querySelectorAll('.seigo-tab-item');
    logs.push(`[INFO] 教科タブ要素数: ${allTabItems.length}`);

    const tabLinks = [];
    allTabItems.forEach((item, idx) => {
        const a = item.querySelector('a');
        const isActive = item.classList.contains('active');
        const href = a ? a.href : "(リンクなし)";
        const text = a ? a.textContent.trim() : "(テキストなし)";
        logs.push(`[TAB ${idx}] text="${text}", href="${href}", active=${isActive}`);
        if (a && !isActive) {
            tabLinks.push({ element: a, text, href });
        }
    });

    if (tabLinks.length === 0) {
        logs.push("[WARN] 非アクティブなタブが見つかりませんでした。現在ページのみ返します。");
        return { success: true, data: results, logs };
    }

    // ローカルファイルチェック
    logs.push(`[INFO] protocol=${window.location.protocol}, origin=${window.location.origin}`);
    if (window.location.protocol === 'file:') {
        logs.push("[SKIP] ローカルファイルのため他教科の自動取得をスキップ");
        return { success: true, data: results, logs };
    }

    // 3. 非同期で他タブのデータを取得
    for (const tab of tabLinks) {
        logs.push(`[FETCH] ${tab.text} の取得開始: ${tab.href}`);
        try {
            const response = await fetch(tab.href, { credentials: "include" });
            logs.push(`[FETCH] ${tab.text} レスポンス: status=${response.status}, ok=${response.ok}`);

            if (!response.ok) {
                logs.push(`[ERROR] ${tab.text} HTTPエラー: ${response.status} ${response.statusText}`);
                continue;
            }

            const htmlText = await response.text();
            logs.push(`[FETCH] ${tab.text} HTML取得完了: ${htmlText.length}文字`);

            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, "text/html");

            // fetchしたHTMLでは別の教科がactiveになっているはず
            const fetchedActiveTab = doc.querySelector('.seigo-tab-item.active a');
            if (fetchedActiveTab) {
                logs.push(`[PARSE] ${tab.text} のHTML内のアクティブ教科: "${fetchedActiveTab.textContent.trim()}"`);
            } else {
                logs.push(`[WARN] ${tab.text} のHTML内にアクティブ教科タブが見つかりませんでした`);
                // リダイレクトされてログインページなどに飛ばされている可能性
                const title = doc.querySelector('title');
                logs.push(`[WARN] ページタイトル: "${title ? title.textContent : '(なし)'}"`);
                continue;
            }

            const parsedData = scrapeDataFromDoc(doc);
            logs.push(`[OK] ${tab.text} パース成功: 教科=${parsedData.subject}, 問題数=${parsedData.questions.length}`);
            results.push(parsedData);

        } catch (e) {
            logs.push(`[ERROR] ${tab.text} の取得/パースに失敗: ${e.message}`);
        }
    }

    logs.push(`[DONE] 合計 ${results.length} 教科分を返します`);
    return { success: true, data: results, logs };
}

function parseExamDate(rawDateStr) {
    const gradeMatch = rawDateStr.match(/(\d+)\s*年生/);
    const dateMatch = rawDateStr.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);

    const grade = gradeMatch ? parseInt(gradeMatch[1], 10) : null;
    const year = dateMatch ? parseInt(dateMatch[1], 10) : null;
    const month = dateMatch ? parseInt(dateMatch[2], 10) : null;
    const day = dateMatch ? parseInt(dateMatch[3], 10) : null;

    let isoDate = null;
    if (year && month && day) {
        isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    return { grade, year, month, day, isoDate };
}

function parseCategory(rawUnit) {
    let category = rawUnit;
    let subCategory = "";

    const dashMatch = rawUnit.match(/^(.+?)－(.+)$/);
    if (dashMatch) {
        category = dashMatch[1].trim();
        subCategory = dashMatch[2].trim();
        return { category, subCategory };
    }

    const semiMatch = rawUnit.match(/^(.+?)[；;](.+)$/);
    if (semiMatch) {
        category = semiMatch[1].trim();
        subCategory = semiMatch[2].replace(/[；;]\s*$/, '').trim();
        return { category, subCategory };
    }

    const colonMatch = rawUnit.match(/^(.+?)：(.+)$/);
    if (colonMatch) {
        category = colonMatch[1].trim();
        subCategory = colonMatch[2].trim();
        return { category, subCategory };
    }

    const hyphenMatch = rawUnit.match(/^(.+?)-(.+)$/);
    if (hyphenMatch) {
        category = hyphenMatch[1].trim();
        subCategory = hyphenMatch[2].trim();
        return { category, subCategory };
    }

    return { category, subCategory };
}

function scrapeDataFromDoc(doc) {
    const testNameEl = doc.querySelector('h1.headingBox-main');
    const testDateEl = doc.querySelector('.date-text');
    const activeSubjectEl = doc.querySelector('.seigo-tab-item.active a');

    if (!testNameEl || !testDateEl || !activeSubjectEl) {
        throw new Error("テスト結果情報が見つかりません。");
    }

    const testName = testNameEl.innerText.trim();
    const testDateRaw = testDateEl.innerText.trim();
    const subject = activeSubjectEl.innerText.trim();

    const parsedDate = parseExamDate(testDateRaw);
    const testId = `${parsedDate.isoDate || testDateRaw}_${testName}_${subject}`.replace(/\s+/g, '_');

    const pointEl = doc.querySelector('.point-text');
    const answerEl = doc.querySelector('.answer-text');
    const score = pointEl ? pointEl.innerText.trim() : null;
    const answerSummary = answerEl ? answerEl.innerText.trim() : null;

    const rows = doc.querySelectorAll('.seigo-anser-guide_table tbody tr');
    const questions = [];

    rows.forEach(row => {
        const tds = row.querySelectorAll('td');
        if (tds.length >= 7) {
            const number = tds[0].innerText.trim();
            const rawUnit = tds[1].innerText.trim();
            
            const resultRaw = tds[2].innerText.trim();
            const result = resultRaw === "" ? "未掲載" : resultRaw;

            const parsed = parseCategory(rawUnit);

            const correctRateRaw = tds[4].innerText.trim();
            const incorrectRateRaw = tds[5].innerText.trim();
            const noAnswerRateRaw = tds[6].innerText.trim();
            const correctRate = parseInt(correctRateRaw, 10) || 0;
            const incorrectRate = parseInt(incorrectRateRaw, 10) || 0;
            const noAnswerRate = parseInt(noAnswerRateRaw, 10) || 0;

            questions.push({
                number,
                rawUnit,
                category: parsed.category,
                subCategory: parsed.subCategory,
                result,
                correctRate,
                incorrectRate,
                noAnswerRate
            });
        }
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
