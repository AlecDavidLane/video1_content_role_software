/** Build-time model bundling (brief §7): the release ships the emotion
 * models; the kiosk NEVER downloads at the venue. Run on the build
 * machine (internet required THERE only): npm run fetch-models
 *
 * Local ids match lib/emotion.js MODEL_BY_LOCALE.
 */
import fs from 'node:fs'
import path from 'node:path'

const MODELS = [
  {
    local: 'distilbert-emotion-en',
    repo: 'Xenova/distilbert-base-uncased-emotion', // 6 labels -> LABEL_TO_FACE
  },
  {
    local: 'sentiment-multilingual',
    repo: 'Xenova/distilbert-base-multilingual-cased-sentiments-student', // pos/neu/neg incl. Spanish
  },
]
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
]

const outRoot = path.join(process.cwd(), 'public', 'models')

for (const model of MODELS) {
  for (const file of FILES) {
    const url = `https://huggingface.co/${model.repo}/resolve/main/${file}`
    const dest = path.join(outRoot, model.local, file)
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`cached  ${model.local}/${file}`)
      continue
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    process.stdout.write(`fetch   ${model.local}/${file} ... `)
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) {
      console.error(`FAILED (${res.status}) ${url}`)
      process.exit(1)
    }
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
    console.log(`${(fs.statSync(dest).size / 1e6).toFixed(1)} MB`)
  }
}
console.log(`Models bundled under ${outRoot}`)
