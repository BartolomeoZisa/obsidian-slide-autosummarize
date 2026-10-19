# Publishing to the Obsidian community directory

I can prepare the repo, but **you** have to do the final submission: it needs your
GitHub account and a pull request to `obsidianmd/obsidian-releases`. Nothing here
can be done on your behalf.

Time: ~10 minutes, plus a few days to a couple of weeks for review.

---

## 1. Fill in your details

Edit `manifest.json`:

```json
{
  "author": "Bartolomeo Zisa",
  "authorUrl": "https://github.com/BartolomeoZisa"
}
```

`id` (`slide-autosummarize`) is permanent once published — don't change it later.

## 2. Create the GitHub repo

> Already done: the repo is live at
> <https://github.com/BartolomeoZisa/obsidian-slide-autosummarize>.
> Skip to step 3.

```bash
cd obsidian-slide-autosummarize
git init
git add .
git commit -m "Initial commit"
```

Create an **empty public** repo on GitHub named `obsidian-slide-autosummarize`
(no README/license — you already have them), then:

```bash
git remote add origin https://github.com/BartolomeoZisa/obsidian-slide-autosummarize.git
git push -u origin main
```

Make sure `main.js` **is** committed for releases — it is intentionally not in
`.gitignore`. The release workflow also rebuilds it, so the attached asset always
matches the tagged source.

## 3. Cut a release

```bash
npm version 0.1.0        # or: npm version patch
git push --follow-tags
```

`version-bump.mjs` syncs `manifest.json`, `package.json` and `versions.json`.
The `release.yml` workflow then builds the plugin and creates a **draft** release
with `main.js`, `manifest.json`, `styles.css` attached.

**The draft must be published** — while it is a draft, the download URLs below
return 404 and neither BRAT nor manual install can fetch the plugin.

Go to **Releases → the draft → Edit → Publish release**.

Verify all three resolve (HTTP 200):

```bash
BASE=https://github.com/BartolomeoZisa/obsidian-slide-autosummarize/releases/latest/download
for f in main.js manifest.json styles.css; do
  curl -s -o /dev/null -w "$f -> %{http_code}\n" -L "$BASE/$f"
done
```

## 4. Open the submission PR

1. Fork <https://github.com/obsidianmd/obsidian-releases>.
2. Edit `community-plugins.json` and append one object at the end of the array:

   ```json
   {
     "id": "slide-autosummarize",
     "name": "Slide Autosummarize",
     "author": "Bartolomeo Zisa",
     "description": "Auto-summarize PDF slide decks into study-ready Markdown class notes with LaTeX equations and LLM-picked figure crops.",
     "repo": "BartolomeoZisa/obsidian-slide-autosummarize"
   }
   ```

   Rules that trip people up:
   - `id` must match `manifest.json` exactly.
   - `description` must match `manifest.json` exactly (same punctuation), and must
     not start with "This is a plugin…" or contain "Obsidian".
   - No trailing comma; the file must stay valid JSON.

3. Commit, push to your fork, open a PR titled **"Add plugin: Slide Autosummarize"**.
4. The bot runs automated checks. Fix anything it flags; a human then reviews.

## 5. After acceptance

The plugin appears in **Settings → Community plugins → Browse** within ~24h of the
merge. Later updates: bump the version, push a tag, publish the release — the
directory picks up new releases automatically. No new PR needed unless you change
`id`, `author` or the repo.

---

## Pre-submission checklist

- [ ] `manifest.json` has your real `author` / `authorUrl`
- [ ] `id` is unique and lowercase-with-hyphens
- [ ] `versions.json` contains the current version → `minAppVersion`
- [ ] `main.js` is attached to the published release
- [ ] Release is **published**, not draft
- [ ] `README.md` explains install and use
- [ ] `LICENSE` present (GPL-3.0-or-later — OSI-approved, accepted by the directory)
- [ ] No API keys or secrets committed (`data.json` is not in the repo)
- [ ] Plugin works with Restricted mode off in a clean vault
