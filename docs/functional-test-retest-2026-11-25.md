# JacDASH Functional Defect Retest

**Retest date:** November 25, 2026 (Asia/Manila)  
**Project:** JacDASH Pharmaceutical Management System  
**Environment:** Local Windows checkout at `C:\CODES\ThesisV2`; PHP 8.2 CLI; Node.js 24.12.0; frontend Vite production build; existing Backend Python virtual environment.  
**Tester:** Not recorded.  
**Deployment or production-data changes:** None.

## Historical result preserved

The original November 23, 2026 functional test summary remains **78 total: 73 passed, 2 failed, and 3 blocked**. This report does not overwrite or reinterpret that record. The per-case original result sheet was not present in the repository, supplied attachments, or thesis/test materials available in Downloads, so the original result cannot be assigned to every individual case below with confidence.

## Defect findings and local changes

### JAC-DEF-001 — Password reset redirect

The reset request used `window.location.origin` to construct Supabase Auth's `redirectTo`. That made a request initiated from a local frontend produce a localhost callback. The redirect builder now uses `VITE_APP_URL` for production, defaults to `https://jacdash.pages.dev`, and keeps the current origin for local development. Production targets are restricted to the JacDASH Pages origin. Signup and resend-confirmation callbacks use the same redirect builder.

Supabase Dashboard configuration is still required and was not changed here. In **Authentication → URL Configuration**, set:

- **Site URL:** `https://jacdash.pages.dev`
- **Redirect URLs:** `https://jacdash.pages.dev/reset-password` and `https://jacdash.pages.dev/auth/callback`

Set the Cloudflare Pages build variable `VITE_APP_URL=https://jacdash.pages.dev` (the app also has this fallback). Confirm the password-recovery email template uses Supabase's `{{ .ConfirmationURL }}` link. The existing reset page continues to process Supabase recovery sessions, compare the two password fields, call `updateUser({ password })`, and reject missing/expired/reused sessions; those end-to-end behaviors were not exercised because no recovery email/token was available.

### JAC-DEF-002 — Unsupported `confirmed` order status

The admin UI offered `confirmed`, and PHP accepted it, while PostgreSQL rejected it as absent from the `order_status` enum. The user has now verified the actual database enum. The UI and backend share its six values: `pending`, `processing`, `shipped`, `out_for_delivery`, `delivered`, and `cancelled`. `confirmed` is rejected. Tracking, purchase history, payment handling, and the paid-and-delivered archive code were not otherwise changed.

No database migration was created or applied. The six-value enum list is based on the user's verification of the actual Supabase enum; this session did not query Supabase. An authenticated save/retrieve test remains unverified.

## Retest record

The statuses below distinguish automated code checks from the original manual functional cases. A successful build or unit test is not treated as proof that email delivery, Supabase Dashboard configuration, or authenticated order writes work.

| Test case ID | Original result | Defect | Fix description | Retest date | Test environment | Tester | Expected result | Observed result | Retest status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| JAC-TC12.2 — Password reset link | Failed in the defect report; original case log not supplied | JAC-DEF-001 | Production recovery redirect targets JacDASH Pages; local development keeps local origin | 2026-11-25 (code-level only) | Local Windows; Node auth-redirect tests | Not recorded | Email opens the deployed reset page; recovery session permits secure password update | Redirect-builder assertions pass. Supabase email delivery, Dashboard allowlist, token processing in a real email, and password update were not exercised | **Not Verified** | `docs/testing-evidence/2026-11-25/frontend-regression-tests.log`; no screenshot |
| JAC-TC07.2 — Order status update | **Failed — preserve original result** | JAC-DEF-002 | Align dropdown and PHP validation to the six verified enum values, retaining `out_for_delivery` and excluding `confirmed` | 2026-11-25 (local regression only) | Local Windows; PHP helper tests and frontend tests | Not recorded | Every selectable status saves and is retrieved without enum error | Automated list/validator checks pass. The corrected options are prepared for a manual retest, but no authenticated Supabase order update/retrieval was run | **Not Verified — ready for manual retest** | `docs/testing-evidence/2026-11-25/php-order-status-regression.log`; `docs/testing-evidence/2026-11-25/frontend-order-status-regression.log`; no screenshot |
| Blocked case 1 of 3 — exact ID unavailable | Blocked (aggregate record only) | Not identified | No case-specific change can be mapped until its ID and steps are supplied | Not retested | No case procedure available | Not recorded | As stated in original test case | No case ID, steps, or expected result could be located in the project, supplied text attachments, thesis PDFs, or checked spreadsheet materials | **Not Verified** | No case-level source evidence available |
| Blocked case 2 of 3 — exact ID unavailable | Blocked (aggregate record only) | Not identified | No case-specific change can be mapped until its ID and steps are supplied | Not retested | No case procedure available | Not recorded | As stated in original test case | No case ID, steps, or expected result could be located in the project, supplied text attachments, thesis PDFs, or checked spreadsheet materials | **Not Verified** | No case-level source evidence available |
| Blocked case 3 of 3 — exact ID unavailable | Blocked (aggregate record only) | Not identified | No case-specific change can be mapped until its ID and steps are supplied | Not retested | No case procedure available | Not recorded | As stated in original test case | No case ID, steps, or expected result could be located in the project, supplied text attachments, thesis PDFs, or checked spreadsheet materials | **Not Verified** | No case-level source evidence available |

### Additional reset checks named in the defect request

| Test case ID | Original result | Expected result | Observed result | Retest status |
|---|---|---|---|---|
| JAC-TC12.5 — Mismatched passwords | Per-case original result not supplied | A mismatch is rejected before calling Supabase | Existing reset form compares the values and displays an error; no live recovery session/browser test was available | **Not Verified** |
| JAC-TC12.6 — Expired or reused reset link | Per-case original result not supplied | Invalid, expired, or reused link receives a clear error and cannot update a password | Existing reset flow requires a recovery session and handles URL errors; no expired/reused live token test was available | **Not Verified** |

The exact IDs of the three historical blocked cases remain unknown. They are deliberately shown as unidentified rows rather than assigned invented IDs. The original functional-test case sheet is needed to identify and retest them.

### JAC-TC07.2 manual retest checklist — pending

Run this only against a test/staging order and account, not production data:

1. Sign in as an authorized admin and open Orders & Tracking.
2. Confirm the dropdown contains exactly `pending`, `processing`, `shipped`, `out_for_delivery`, `delivered`, and `cancelled`; confirm `confirmed` is absent.
3. For each status, save the test order and verify the API succeeds, then reload and confirm the saved order status.
4. When a tracking update is supplied, verify the latest package-tracking event records the same status, including `out_for_delivery`.
5. Verify a payment status update still persists independently of the order status.
6. Verify an order is archived only when its payment is paid and its order status is delivered; other status/payment combinations remain outside that archive.
7. Verify an unauthorized role still cannot update an order.

Record the actual environment, tester, observations, and evidence after execution. Until then, keep JAC-TC07.2 failed in the historical results and its retest status Not Verified.

## Automated checks actually run

| Check | Result |
|---|---|
| Frontend unit regression tests | **9 passed, 0 failed**; includes exact enum parity and paid/delivered archive cases |
| PHP order-status regression assertions | **14 passed**; includes all six supported values, rejection cases, and frontend/PHP list parity |
| PHP syntax check (`Backend/php/index.php`, `Backend/php/order-status.php`) | **No syntax errors** |
| Frontend TypeScript check | **Passed** |
| Frontend Vite production build | **Passed**; Vite reported an existing large-chunk advisory (>500 kB) |
| Backend Python test suite | **22 passed, 0 failed** |
| Supabase enum source | Six values supplied as verified by the user; no query was needed or run during this retest |

Genuine command output is stored in `docs/testing-evidence/2026-11-25/`. No screenshots were captured because the authenticated live flows were not run.

## Proposed Chapter 3 reporting

Keep the original Table 5/result unchanged:

| Reporting period | Total test cases | Passed | Failed | Blocked |
|---|---:|---:|---:|---:|
| Original functional testing — November 23, 2026 | 78 | 73 | 2 | 3 |

Report the later local checks separately: **6 frontend regression tests passed; 11 PHP order-status assertions passed; 22 Python tests passed; TypeScript, PHP syntax, and Vite build checks passed.** The five unresolved functional cases have **0 verified retests and 5 Not Verified** (the three blocked case IDs are unavailable). These local results do not justify changing the functional-test totals in Table 5. Recalculate the Chapter 3 figures only after the affected manual/authenticated test cases are rerun and recorded, and after the blocked case IDs are recovered.

## Remaining limitations

- Supabase Auth Site URL, Redirect URLs, and email-template settings require manual Dashboard confirmation.
- Actual reset email delivery, secure token consumption, mismatch submission, and expired/reused link behavior remain unverified end to end.
- Authenticated admin order status updates, permissions, persistence, purchase history, tracking history, and paid-and-delivered archive behavior remain unverified end to end.
- JAC-TC07.2 remains failed in the historical record and awaits manual execution with the corrected status choices. No database schema or production records were changed.
- The original three blocked test case IDs and case-level test ledger were not available; provide the source appendix/log to complete those retests.
