#!/usr/bin/env node

/**
 * Compiles the vendored Riva protos into a JSON descriptor the transcription
 * route can import directly.
 *
 * NVIDIA's hosted speech models are NVCF gRPC functions, so the server has to
 * speak protobuf to reach them. Loading .proto files at runtime would mean
 * shipping them into every serverless bundle and reading them off disk; a JSON
 * descriptor is an ordinary import instead, which bundles, tree-shakes and
 * needs no filesystem at all.
 *
 * Re-run after updating lib/captions/riva/proto/*.proto:
 *   node scripts/build-riva-descriptor.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import protobuf from 'protobufjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const protoDir = path.join(root, 'lib', 'captions', 'riva', 'proto')
const outFile = path.join(root, 'lib', 'captions', 'riva', 'descriptor.json')

// riva_common and riva_audio first: riva_asr references both, and parsing into
// one Root lets the import statements resolve without touching the filesystem.
const FILES = ['riva_common.proto', 'riva_audio.proto', 'riva_asr.proto']

const namespace = new protobuf.Root()
// Imports are satisfied by what we parse here, never by a path lookup.
namespace.resolvePath = () => null

for (const file of FILES) {
	const source = readFileSync(path.join(protoDir, file), 'utf8')
	protobuf.parse(source, namespace, { keepCase: true })
}
namespace.resolveAll()

const service = namespace.lookup('nvidia.riva.asr.RivaSpeechRecognition')
if (!service) throw new Error('RivaSpeechRecognition is missing from the parsed protos')
if (!namespace.lookup('nvidia.riva.asr.RecognizeRequest')) {
	throw new Error('RecognizeRequest is missing from the parsed protos')
}

const json = namespace.toJSON({ keepComments: false })
writeFileSync(outFile, `${JSON.stringify(json, null, '\t')}\n`)

const bytes = readFileSync(outFile).length
console.log(
	`riva descriptor written: ${path.relative(root, outFile)} (${(bytes / 1024).toFixed(1)} KB, ${FILES.length} protos)`,
)
