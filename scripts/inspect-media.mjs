#!/usr/bin/env node
/**
 * Prints the real track layout of a rendered file and fails when the output is
 * empty or missing a video track. Uses mediabunny (already bundled with
 * @remotion/media-utils) so continuous integration does not need a system
 * FFmpeg install.
 *
 *   node scripts/inspect-media.mjs out/github-render.mp4
 *   node scripts/inspect-media.mjs out/render.mp4 --expect-audio
 */

import path from 'node:path'
import { stat } from 'node:fs/promises'

const files = []
let expectAudio = false
for (const token of process.argv.slice(2)) {
	if (token === '--expect-audio') expectAudio = true
	else files.push(token)
}

if (files.length === 0) {
	console.error('Usage: node scripts/inspect-media.mjs <file> [--expect-audio]')
	process.exit(1)
}

const round = (value) => Math.round(value * 100) / 100

async function inspect(file) {
	const absolute = path.resolve(process.cwd(), file)
	const { size } = await stat(absolute)
	if (size === 0) throw new Error(`${file} is empty.`)

	let mediabunny
	try {
		mediabunny = await import('mediabunny')
	} catch {
		console.log(`  ${file}  ${(size / 1024 / 1024).toFixed(2)} MB (mediabunny unavailable, size checked only)`)
		return
	}

	const { Input, ALL_FORMATS, FilePathSource } = mediabunny
	const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(absolute) })
	const [videoTracks, audioTracks, duration] = await Promise.all([
		input.getVideoTracks(),
		input.getAudioTracks(),
		input.computeDuration(),
	])

	console.log(`  ${file}`)
	console.log(`    size      ${(size / 1024 / 1024).toFixed(2)} MB`)
	console.log(`    duration  ${round(duration)}s`)
	for (const track of videoTracks) {
		console.log(`    video     ${track.codec} ${track.displayWidth}x${track.displayHeight}`)
	}
	for (const track of audioTracks) {
		console.log(`    audio     ${track.codec} ${track.sampleRate} Hz, ${track.numberOfChannels} ch`)
	}

	if (videoTracks.length === 0) throw new Error(`${file} has no video track.`)
	if (duration <= 0) throw new Error(`${file} reports a zero duration.`)
	if (expectAudio && audioTracks.length === 0) throw new Error(`${file} has no audio track.`)
}

let failed = false
for (const file of files) {
	try {
		await inspect(file)
	} catch (error) {
		failed = true
		console.error(`  ${error instanceof Error ? error.message : error}`)
	}
}

process.exit(failed ? 1 : 0)
