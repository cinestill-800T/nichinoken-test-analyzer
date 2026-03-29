Validate a Nichinoken Test Analyzer JSON output file against the v3.0 schema.

## How to use
If the user specified a file path as an argument, use that. Otherwise look for JSON files in the current directory that match `nichinoken_*.json`.

## Validation rules

### Top-level fields (required)
- `version`: must be `"3.0"`
- `extractedAt`: must be a valid ISO 8601 datetime string
- `testName`: must be a non-empty string
- `testDateRaw`: string (may be empty)
- `examDate`: object with optional fields `grade`, `round`, `year`, `month`, `day`, `isoDate`
- `subjects`: array (may be empty if only summary data was extracted)
- `summary`: object or null

### `subjects[]` item fields
- `subject`: non-empty string
- `score`: number or null
- `scoreRaw`: string or null
- `answerSummary`: string or null
- `questions`: array

### `questions[]` item fields
- `number`: string
- `rawUnit`: string
- `category`: string
- `subCategory`: string
- `result`: one of `"○"`, `"×"`, `"未掲載"`, or other string
- `correctRate`: integer 0–100
- `incorrectRate`: integer 0–100
- `noAnswerRate`: integer 0–100
- rate sum (correctRate + incorrectRate + noAnswerRate) should be close to 100 (allow ±2 for rounding)

### `summary` object fields (when present)
- `examType`: `"training"` or `"public"`
- `basicSummary`: array
- `rankings`: array

### `fieldAccuracyRate` data type (alternate schema)
If `dataType === "fieldAccuracyRate"` at top level, validate:
- `searchCondition`: object with subject/grade/term/testType fields
- `fields`: array of category entries with `difficulty.star1/star2/star3/overall`

## Output format
Report results as:
1. **PASS / FAIL** summary
2. List of any schema violations found (field path + description)
3. Statistics: subject count, total question count, × count, % of incorrect answers
4. Warn if any `correctRate + incorrectRate + noAnswerRate` deviates from 100 by more than 2
