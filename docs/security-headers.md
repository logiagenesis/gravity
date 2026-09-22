# Security headers

The canonical definition is `public/_headers` (Netlify / Cloudflare Pages
format). These equivalents exist so the posture is portable and does not depend
on a single host.

Each header answers a gap measured on the audited deployment
(`artifacts/03-current-site-audit.md` §12.1), which sent a CSP containing only
`frame-ancestors`, HSTS without `includeSubDomains`, and no
`X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy` at all.

`style-src` allows `'unsafe-inline'` because the renderer and React set inline
styles. That is a deliberate, narrow concession: `script-src` remains `'self'`
with no `'unsafe-inline'` and no `'unsafe-eval'`, so script injection is still
blocked.

## nginx

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; upgrade-insecure-requests" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;

location /assets/ {
  add_header Cache-Control "public, max-age=31536000, immutable" always;
}
```

## Caddy

```caddy
header {
  Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; upgrade-insecure-requests"
  Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
  X-Content-Type-Options "nosniff"
  Referrer-Policy "strict-origin-when-cross-origin"
  Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()"
  Cross-Origin-Opener-Policy "same-origin"
  Cross-Origin-Resource-Policy "same-origin"
}
```

## Verifying

After deploying, confirm with:

```
curl -sSI https://<host>/ | grep -iE 'content-security|strict-transport|x-content-type|referrer-policy|permissions-policy|x-frame'
```

or a public scanner such as securityheaders.com.

## GitHub Pages: what is and is not achievable

GitHub Pages serves no custom response headers. `public/_headers` is honoured by
Cloudflare Pages and Netlify but is **inert on Pages**, so the primary
deployment relies on a `<meta http-equiv="Content-Security-Policy">` tag in
`index.html`.

A meta-delivered CSP is strictly weaker than a header. What carries over, and
what does not:

| Protection                                                                                                                            | Header deploy | GitHub Pages | Why                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `default-src`, `script-src`, `style-src`, `img-src`, `font-src`, `connect-src`, `worker-src`, `object-src`, `base-uri`, `form-action` | ✅            | ✅ meta      | Supported in meta CSP                                                                                            |
| `frame-ancestors`                                                                                                                     | n/a           | ❌           | Ignored in meta CSP by specification — and deliberately not sent on a header deploy either; see below            |
| `X-Frame-Options: DENY`                                                                                                               | n/a           | ❌           | Header-only, and deliberately not sent; see below                                                                |
| `Strict-Transport-Security`                                                                                                           | ✅            | ⚠️ partial   | Header-only for us, but `github.io` is on the HSTS preload list, so browsers enforce HTTPS for the domain anyway |
| `X-Content-Type-Options: nosniff`                                                                                                     | ✅            | ❌           | Header-only. GitHub Pages does send correct `Content-Type` values                                                |
| `Referrer-Policy`                                                                                                                     | ✅            | ⚠️ meta      | `<meta name="referrer">` covers this; currently not set                                                          |
| `Permissions-Policy`                                                                                                                  | ✅            | ❌           | Header-only                                                                                                      |

**Assessment.** For a static site with no authentication, no cookies, no user
accounts and no third-party requests, the residual risk from the missing
headers is low. What Pages costs us is `nosniff` and `Permissions-Policy`, both
of which matter little here: Pages sends correct `Content-Type` values, and the
app requests no permissioned APIs. Framing used to be listed as the one genuine
loss; it is now a deliberate choice on both deployments, argued below, so the
two no longer disagree.

## The framing decision, resolved

Earlier revisions of this document deferred one question to the milestone that
implemented embedding: a header-based deploy sent `frame-ancestors 'none'` and
`X-Frame-Options: DENY`, which forbids framing outright, while GitHub Pages
cannot send either and so permits it. The two deployments disagreed, and
`?embed=1` — a chrome-less view built to be put inside a lesson page — is
unusable under the stricter one.

**Decision: framing is allowed, on every deployment.** `frame-ancestors` and
`X-Frame-Options` are removed from `public/_headers` and from the nginx and
Caddy equivalents above.

The reasoning, so this can be re-argued rather than inherited:

- **Clickjacking needs something to steal.** The threat is tricking somebody
  into performing, inside a hidden frame, an action that benefits the attacker.
  There is no account, no session, no cookie, no server and no payment. The only
  state is the visitor's own saved scenarios and their detail-level preference,
  both in their own browser. The worst available outcome is persuading someone
  to delete a scenario they saved, which benefits nobody.
- **Denying it would break a stated goal.** Classroom embedding is a
  requirement, not a nice-to-have, and `X-Frame-Options` has no usable
  allow-list (`ALLOW-FROM` is obsolete and unsupported). An allow-list of
  `frame-ancestors` would mean knowing every school and lesson page in advance,
  which is not knowable.
- **The real residual risk is presentational, not technical.** Somebody may
  frame the simulator inside a page that implies the work is theirs. The
  mitigation is in the product rather than in a header: the embedded view keeps
  a visible attribution link to the deployment it is served from, and keeps the
  data citation and the trustworthiness warnings. An embedded simulation that
  could not say what it is, or where its numbers came from, would be the thing
  actually worth preventing.
- **Nothing else is relaxed.** `Cross-Origin-Opener-Policy` and
  `Cross-Origin-Resource-Policy` are unaffected: COOP governs top-level
  browsing contexts and CORP governs subresource fetches, and neither is what
  permits or denies a frame.

**To reverse this** for a private deployment that does not want embedding, put
`frame-ancestors 'none'` back into the CSP in `public/_headers` and re-add
`X-Frame-Options: DENY`. `?embed=1` will still strip the chrome; it simply
will not be loadable in a frame.
