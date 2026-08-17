/** Build-time model bundling (brief §7): the release ships the emotion
 * models; the kiosk NEVER downloads at the venue. Run on the build
 * machine (internet required THERE only): npm run fetch-models
 *
 * Candidate repos are tried in order (mirrors the upstream demo's
 * MODEL_CHAIN - not every mirror exists). Files are saved into the
 * layout @huggingface/transformers expects locally, whatever layout the
 * source repo uses. Local ids match lib/emotion.js MODEL_BY_LOCALE.
 */
import fs from 'node:fs'
import path from 'node:path'

const MODELS = [
  {
    local: 'emotion-en',
    repos: [
      'SamLowe/roberta-base-go_emotions-onnx',
      'Xenova/roberta-base-go_emotions',
      'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    ],
  },
  {
    local: 'sentiment-multilingual',
    repos: [
      'Xenova/distilbert-base-multilingual-cased-sentiments-student',
      'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    ],
  },
]

// dest (transformers.js local layout) -> source path candidates in-repo
const FILES = [
  { dest: 'config.json', sources: ['config.json'], required: true },
  { dest: 'tokenizer.json', sources: ['tokenizer.json'], required: true },
  { dest: 'tokenizer_config.json', sources: ['tokenizer_config.json'], required: false },
  {
    dest: 'onnx/model_quantized.onnx',
    sources: ['onnx/model_quantized.onnx', 'model_quantized.onnx', 'onnx/model.onnx', 'model.onnx'],
    required: true,
  },
]

const outRoot = path.join(process.cwd(), 'public', 'models')

async function tryFetch(url) {
  const res = await fetch(url, { redirect: 'follow' })
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null
}

async function fetchModel(model) {
  for (const repo of model.repos) {
    const probe = await tryFetch(`https://huggingface.co/${repo}/resolve/main/config.json`)
    if (!probe) {
      console.log(`skip    ${repo} (not accessible)`)
      continue
    }
    console.log(`using   ${repo} -> ${model.local}`)
    for (const file of FILES) {
      const dest = path.join(outRoot, model.local, file.dest)
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
        console.log(`cached  ${model.local}/${file.dest}`)
        continue
      }
      let data = null
      for (const src of file.sources) {
        data = await tryFetch(`https://huggingface.co/${repo}/resolve/main/${src}`)
        if (data) break
      }
      if (!data) {
        if (file.required) {
          console.error(`FAILED  ${repo} has no ${file.dest} (tried ${file.sources.join(', ')})`)
          return false
        }
        console.log(`absent  ${model.local}/${file.dest} (optional)`)
        continue
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, data)
      console.log(`fetched ${model.local}/${file.dest} ${(data.length / 1e6).toFixed(1)} MB`)
    }
    return true
  }
  return false
}

let ok = true
for (const model of MODELS) {
  if (!(await fetchModel(model))) {
    console.error(`ERROR: no candidate repo worked for ${model.local}`)
    ok = false
  }
}
if (!ok) process.exit(1)
console.log(`Models bundled under ${outRoot}`)
