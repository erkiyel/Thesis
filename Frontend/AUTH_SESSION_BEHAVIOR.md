# Authentication session behavior

JACDASH uses Supabase Auth with `sessionStorage` as the browser storage for its
access and refresh tokens. Automatic token refresh remains enabled. Reloading or
using internal routes in the same tab keeps a valid session available.

The client removes only this Supabase project's former default
`localStorage` auth key during startup. Other local storage entries, including
application preferences, are not removed.

## Browser and tab limits

- In normal browser behavior, closing a tab clears that tab's `sessionStorage`.
- Browsers that restore a previous browsing session may also restore tab session
  storage. Web applications cannot reliably detect a full browser shutdown, so
  reauthentication after browser close cannot be guaranteed in every browser.
- Separate tabs have separate session storage and do not automatically share
  sign-in or sign-out events. A tab opened as a duplicate may begin with a copy
  of the opener's storage, then operate independently.
- Explicit logout signs out the current Supabase session (`scope: local`). Other
  independently authenticated tabs/devices are not signed out.

## Expiration and server behavior

Supabase refreshes valid sessions while the tab is active. Invalid or revoked
refresh sessions are cleared by Supabase Auth and protected routes return to
sign-in. Profile lookup failures do not erase a valid session; the user remains
blocked from role-protected pages until workspace permissions can be checked.

Logout clears this tab's Supabase session and the in-memory React Query cache.
Supabase revokes the refresh token on a best-effort basis. A previously issued
access-token JWT can remain valid at the API until its expiry, so PHP continues
to validate each request and enforce the user's role, but JWT expiry is the
limit on immediate server-side invalidation of a copied token.
