# Security policy

## Reporting a vulnerability

Please do not publish API keys, tokens, personal data, or exploit details in a public issue.
Use GitHub's private vulnerability reporting feature for this repository if it is enabled. Otherwise, contact the repository maintainer privately through their GitHub profile and include steps to reproduce, impact, and affected commit.

## Secrets and deployment

- Never commit `.env`, real API keys, access tokens, or provider credentials.
- Store production credentials only in GitHub Actions Secrets or the hosting provider's secret store.
- Rotate any credential that has ever been committed or exposed. Deleting it from the latest commit is not sufficient; it may remain in Git history.
- Use separate credentials for development and production, with the lowest available quota and permissions.
- Do not expose provider keys in frontend JavaScript, generated JSON, logs, screenshots, or public build artifacts.
- Keep dependencies updated and review automated security alerts.
- Review workflow permissions before adding actions; grant only the minimum permissions required.

## Scope

The public GitHub Pages site is static. API/provider credentials must remain in server-side or GitHub Actions secrets and must never be shipped to the browser.
