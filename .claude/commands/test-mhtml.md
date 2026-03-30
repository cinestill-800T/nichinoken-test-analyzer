Test the content.js parsing logic against a local MHTML file using test_parse.js.

## How to use
The user may specify an MHTML filename as an argument (e.g., `/test-mhtml 全国テスト.mhtml`).
If no argument is given, list all `.mhtml` files in the current directory and ask the user which one to test.

## Steps to perform

1. **Check dependencies**: Verify that `node` is available and that `jsdom` is installed (`node_modules/jsdom` exists or `npm list jsdom` succeeds). If jsdom is missing, show the install command: `npm install jsdom` and stop.

2. **Identify the target MHTML file**: Use the argument if provided. If the file does not exist, list available `.mhtml` files and inform the user.

3. **Run the test**: `test_parse.js` accepts an optional MHTML file path as the first argument (defaults to `分野別正答率｜MY NICHINOKEN.mhtml`).

   For `分野別正答率｜MY NICHINOKEN.mhtml`, run directly:
   ```
   node test_parse.js
   ```

   For a different `分野別正答率` MHTML file:
   ```
   node test_parse.js "path/to/file.mhtml"
   ```

   For other MHTML files (test result pages), the scraping logic is different. Run a quick inline node script that:
   - Reads and decodes the MHTML (quoted-printable)
   - Parses with jsdom
   - Loads content.js functions (stripping the chrome.runtime block)
   - Calls `handleUnifiedScrape()` equivalent using the document

4. **Report results**:
   - If successful: show a summary of what was extracted (testName, examDate, subject count, question count, summary presence)
   - If failed: show the error and suggest which DOM elements might be missing
   - Always show the raw JSON output (pretty-printed, truncated to first 50 lines if very long)

5. **Diagnose common issues**:
   - Missing `.seigo-anser-guide_table` → 正誤一覧ページではない
   - Missing `h1.headingBox-main` → テスト名が見つからない
   - Missing `.date-text` → 日付が見つからない
   - Missing `.CorrectAnswerRate_table` → 分野別正答率ページではない
