# Publishing to the Obsidian community directory

> **The old pull-request route is retired.** Since May 2026 you no longer open a PR
> against `obsidianmd/obsidian-releases` — that repo has pull requests disabled
> (`has_pull_requests: false`), so any PR attempt fails with
> *"does not have the correct permissions"* or a 404.
> Submission is now a web form at <https://community.obsidian.md>.

I prepared everything on the repo side. **You** have to do the submission itself: it
needs your Obsidian account and a GitHub account link. Review is automated and usually
takes a few minutes.

---

## Status

| Step | State |
|---|---|
| GitHub repo public | ✅ <https://github.com/BartolomeoZisa/obsidian-slide-autosummarize> |
| `README.md` with install + usage | ✅ |
| `LICENSE` (GPL-3.0-or-later) | ✅ |
| `manifest.json` (author, authorUrl, description ≤ 250 chars, period) | ✅ |
| `versions.json` | ✅ |
| Release `0.1.1` published with `main.js` + `manifest.json` + `styles.css` | ✅ |
| Directory submission | ⬜ **you** |

---

## 1. Before you submit (already done — verify only)

The directory reads the `manifest.json` **at the head of your default branch**, not the
release. Make sure it is committed and pushed:

```bash
cd obsidian-slide-autosummarize
git status          # must be clean
git log --oneline -1
git push origin main
```

Check the release exists and all three assets download:

```bash
BASE=https://github.com/BartolomeoZisa/obsidian-slide-autosummarize/releases/latest/download
for f in main.js manifest.json styles.css; do
  curl -s -o /dev/null -w "$f -> %{http_code}\n" -L "$BASE/$f"
done
```

All three must print `200`. The release tag (`0.1.1`) must equal `version` in
`manifest.json`.

## 2. Submit through the Community site

1. Sign in at <https://community.obsidian.md> with your **Obsidian account**
   (create one if needed — it is separate from GitHub).
2. In your profile, **connect your GitHub account**. This lets the directory verify
   you own the repo; read-only public profile access is enough.
3. Go to the **Plugins** area → **New plugin** (or *Submit a plugin*).
4. Paste the repository URL:

   ```
   https://github.com/BartolomeoZisa/obsidian-slide-autosummarize
   ```

5. Choose the owner (yourself) and complete the steps in the dashboard.
6. Submit. Automated review starts immediately.

## 3. Handle the review

The dashboard reports findings grouped into **Manifest**, **Releases**, **Source code**
and **Build verification**, each as error / warning / recommendation / pass.

- **Errors** block publication — fix them, bump the version, publish a new release.
- **Warnings** do not block, but they usually predict user-visible problems.

To fix and resubmit:

```bash
npm version patch          # or minor/major
git push --follow-tags     # triggers the release workflow -> draft release
# publish the draft on GitHub, then re-run the scan from the dashboard
```

You can also run the same checks locally before submitting:

```bash
npm run build
npx eslint --version >/dev/null 2>&1 || true   # optional: official Obsidian lint rules
```

The dashboard can also **preview-scan** any branch, tag or commit without releasing.

## 4. After approval

- The plugin appears in **Settings → Community plugins → Browse** within ~24 hours.
- Announce it in the forums (*Share & showcase*) and on Discord (`#updates`, needs the
  `developer` role).
- Future updates: just bump the version and publish a GitHub release. New releases are
  reviewed automatically; no resubmission needed.

---

## Checklist

- [x] `manifest.json` has real `author` / `authorUrl`
- [x] `id` unique (`slide-autosummarize`), lowercase-with-hyphens, no "obsidian"
- [x] `description` ≤ 250 chars, ends with a period, no emoji, no "This is a plugin"
- [x] `versions.json` maps `0.1.1` → `minAppVersion`
- [x] `main.js` attached to a **published** release (not draft)
- [x] Release tag matches `manifest.json` version
- [x] `README.md` explains install and use
- [x] `LICENSE` present (GPL-3.0-or-later)
- [x] No secrets committed (`data.json` is not in the repo)
- [x] No Node.js/Electron APIs (so `isDesktopOnly: false` is correct)
- [ ] Submitted via <https://community.obsidian.md>
