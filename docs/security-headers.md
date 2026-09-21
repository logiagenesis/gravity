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
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
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
  Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests"
  Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
  X-Content-Type-Options "nosniff"
  X-Frame-Options "DENY"
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
| `frame-ancestors`                                                                                                                     | ✅            | ❌           | **Ignored in meta CSP by specification.** Clickjacking protection is unavailable on Pages                        |
| `X-Frame-Options: DENY`                                                                                                               | ✅            | ❌           | Header-only                                                                                                      |
| `Strict-Transport-Security`                                                                                                           | ✅            | ⚠️ partial   | Header-only for us, but `github.io` is on the HSTS preload list, so browsers enforce HTTPS for the domain anyway |
| `X-Content-Type-Options: nosniff`                                                                                                     | ✅            | ❌           | Header-only. GitHub Pages does send correct `Content-Type` values                                                |
| `Referrer-Policy`                                                                                                                     | ✅            | ⚠️ meta      | `<meta name="referrer">` covers this; currently not set                                                          |
| `Permissions-Policy`                                                                                                                  | ✅            | ❌           | Header-only                                                                                                      |

**Assessment.** For a static site with no authentication, no cookies, no user
accounts and no third-party requests, the residual risk from the missing
headers is low. The one genuine loss is `frame-ancestors` / `X-Frame-Options`:
on GitHub Pages the site **can** be framed by anyone. Since there is nothing to
clickjack — no credentials, no state-changing authenticated action — this is
accepted rather than mitigated, and it is recorded here so the decision is
visible rather than accidental.

This limitation also interacts with the planned embeddable classroom mode: on a
header-based deploy, framing is forbidden and embedding would need a deliberate
exception; on Pages it is already possible. That decision is deferred to the
milestone that implements embedding.
