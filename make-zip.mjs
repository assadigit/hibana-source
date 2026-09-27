// make-zip.mjs — the per-version release zip (S120/S156 recipe, sandbox-local helper).
// git-tracked files MINUS e2e/ .github/ eslint.config.mjs hibana.db lighthouserc.json
// playwright.config.ts  PLUS  public/dist/* (content-hashed, untracked)  PLUS the
// directory entries zip -r emits naturally. The tree must be in WIRED-HTML form when
// this runs (node scripts/build.mjs --prod --wire-html) — restore after with
// --restore-html. Output: /home/z/upload/hibana.<version>.zip
import { execSync } from 'node:child_process'
import { mkdtempSync, cpSync, mkdirSync, rmSync, copyFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const out = '/home/z/upload/' + `hibana.${version}.zip`
const stage = mkdtempSync('/tmp/hibana-zip-')
const EXCLUDE = [/^e2e\//, /^\.github\//, /^eslint\.config\.mjs$/, /^hibana\.db$/, /^lighthouserc\.json$/, /^playwright\.config\.ts$/]

const files = execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
let copied = 0
for (const f of files) {
  if (EXCLUDE.some((re) => re.test(f))) continue
  const dest = join(stage, f)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(join(root, f), dest)
  copied++
}
// the built, untracked dist tree rides wholesale
cpSync(join(root, 'public/dist'), join(stage, 'public/dist'), { recursive: true })
const distCount = execSync('ls public/dist | wc -l', { cwd: root, encoding: 'utf8' }).trim()

rmSync(out, { force: true })
execSync(`cd "${stage}" && zip -qr "${out}" .`, { stdio: 'inherit' })
rmSync(stage, { recursive: true, force: true })
const entries = execSync(`unzip -l "${out}" | tail -1`, { encoding: 'utf8' }).trim()
const check = execSync(`unzip -t "${out}" > /dev/null 2>&1 && echo OK`, { encoding: 'utf8' }).trim()
console.log(`hibana.${version}.zip → ${out}\ntracked files: ${copied} · dist files: ${distCount} · ${entries} · integrity: ${check}`)
