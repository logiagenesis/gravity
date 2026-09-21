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
