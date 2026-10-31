# Publish the Duality website

The repository includes a GitHub Actions workflow at `.github/workflows/pages.yml`.

## One-time GitHub configuration

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Merge the deployment workflow into `main`.
4. In **Actions**, check the **Deploy Duality website** run.

Live site:
https://dualityframework-ux.github.io/duality-framework/

If a Pages policy or permissions restriction appears, resolve it in the repository settings. A committed workflow alone does not prove the site is live.

## Assets
- `assets/duality-mark.svg` — scalable logo, usable as an avatar source
- `assets/favicon.svg` — browser icon
- `assets/social-preview.png` — link preview image for LinkedIn and X
