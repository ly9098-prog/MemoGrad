# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Next.js 16 App Router with React 19 and strict TypeScript, matching the repository's locked Admin stack and keeping the user Web deployable as a separate frontend.

## Users

MemoGrad users preparing for the Chinese postgraduate entrance exam, with initial focus on 408 computer-science subjects. They already use the WeChat miniprogram for practice and review and need a browser entry for account setup, identity management, and continuity with the same user ID and learning history.

## Product Purpose

Provide a passwordless user Web entry where people can register or sign in with email verification or GitHub, bind WeChat and email identities to one ordinary-user account, review which identities are active, and safely manage email changes, unlinking, and sign-out. The first release also presents a minimal account home and a clear handoff to the existing miniprogram for the full study workspace.

## Positioning

One MemoGrad account can move across GitHub on the Web, verified email on both Web and miniprogram, and WeChat inside the miniprogram while retaining the same numeric user ID and learning data. Identity linking is explicit and consent-based; matching an email address never silently merges accounts.

## Operating Context

The Web is served from `xzshub.top`, the Admin from `admin.xzshub.top`, and the miniprogram API from `api.xzshub.top`. The browser and Admin use host-only refresh cookies and separate identity domains. The user Web calls the same FastAPI backend as the miniprogram but exposes only the first-release account surface, not the full study workspace.

## Capabilities and Constraints

- Passwordless registration and login through verified email OTP or GitHub OAuth.
- WeChat is available through the existing miniprogram; the user Web can bind or unlink it only after a verified WeChat handoff.
- GitHub identity is keyed by GitHub's stable numeric user ID; its email is not treated as a verified local login identity.
- Email OTP is six digits, expires after five minutes, can be resent after sixty seconds, and is invalidated after three wrong attempts.
- Binding is allowed only from an authenticated account and is rejected when the identity belongs to another user.
- At least one usable login identity must remain. Security-sensitive changes invalidate prior sessions.
- Agreement and privacy acceptance are required before a new account is created, with document versions recorded.
- No ordinary-user password, no self-service account merge, and no full Web practice/review workspace in the first release.
- Product copy and flows are in Simplified Chinese.

## Brand Commitments

The established product name is MemoGrad. The miniprogram uses a calm mint and deep-green study desk palette, an MG mark, restrained glass-and-water material, and plain, direct Chinese copy. The user Web's unauthenticated entry reuses the Admin sign-in atmosphere and control language, while staying deliberately minimal: a dark blue-gray surface, a single restrained glass card, one wordmark, the GitHub action, the email form, and the required agreement control. It omits in-card product logos, explanatory subtitles, mode tabs, and persistent security notes. The GitHub action uses GitHub's official unmodified white Invertocat asset. The authenticated account and settings pages keep the calmer light Mint study-desk world for continuity with the miniprogram.

## Evidence on Hand

- Existing miniprogram login and home implementations under `miniprogram/pages/login/` and `miniprogram/pages/home/`.
- Confirmed domain, identity, session, OTP, and Admin lifecycle decisions in `prompts/tasks/current_task.md` in the primary workspace.
- Backend multi-identity implementation under `backend/app/models/user_auth.py`, `backend/app/api/v1/auth_email.py`, and `backend/app/api/v1/auth_oauth.py`.

## Product Principles

1. Keep one account and one learning history when identity methods change.
2. Make every identity-link and security side effect explicit before it happens.
3. Prefer recoverable, standard account controls over hidden automation or account merging.
4. Keep browser, miniprogram, and Admin security domains visibly and technically separate.
5. Let the account surface feel like the existing MemoGrad study desk, while leaving the study workflow itself to the miniprogram.

## Accessibility & Inclusion

All interactive controls must be keyboard reachable and have visible focus states. Status cannot rely on color alone. Forms provide explicit labels, actionable errors, reduced-motion support, and mobile layouts suitable for one-handed use.
