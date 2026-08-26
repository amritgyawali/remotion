/**
 * Patch-based undo.
 *
 * Every edit is expressed as a `Patch`: a sparse set of entries to write or
 * delete (`null`) in the document's entity maps, plus whole-value replacements
 * for the few fields that are not maps (`trackOrder`, `markers`, `settings`,
 * `name`). A `Command` bundles a patch with its own exact inverse, computed by
 * the constructor at the moment of the edit (in `lib/editor/ops.ts`), from the
 * document as it stood right before the edit.
 *
 * This is simpler than serializing "the opposite command" for twelve
 * different operation types, and it composes for free: undo/redo, coalescing
 * fast drags into one history entry, and autosave-surviving history are all
 * just list operations over `Patch` values, which are themselves plain JSON.
 */

import type { Clip, Marker, ProjectDoc, ProjectSettings, Track } from './types'

export type Patch = {
	name?: string
	settings?: ProjectSettings
	trackOrder?: string[]
	markers?: Marker[]
	tracks?: Record<string, Track | null>
	clips?: Record<string, Clip | null>
	assets?: Record<string, import('./types').Asset | null>
}

export type Command = {
	label: string
	/** entries with the same key within ~600ms merge into one history step - see `Engine.dispatch` */
	coalesceKey?: string
	forward: Patch
	backward: Patch
}

function applyMapPatch<T>(base: Record<string, T>, patch: Record<string, T | null> | undefined): Record<string, T> {
	if (!patch) return base
	let changed = false
	const next = { ...base }
	for (const key in patch) {
		const value = patch[key]
		if (value === null) {
			if (key in next) {
				delete next[key]
				changed = true
			}
		} else {
			next[key] = value
			changed = true
		}
	}
	return changed ? next : base
}

export function applyPatch(doc: ProjectDoc, patch: Patch): ProjectDoc {
	const next: ProjectDoc = {
		...doc,
		name: patch.name ?? doc.name,
		settings: patch.settings ?? doc.settings,
		trackOrder: patch.trackOrder ?? doc.trackOrder,
		markers: patch.markers ?? doc.markers,
		tracks: applyMapPatch(doc.tracks, patch.tracks),
		clips: applyMapPatch(doc.clips, patch.clips),
		assets: applyMapPatch(doc.assets, patch.assets),
		updatedAt: Date.now(),
	}
	return next
}

/** Merges two forward patches for coalescing: `b` wins per-key, both contribute keys the other lacks. */
function mergePatch(a: Patch, b: Patch): Patch {
	return {
		name: b.name ?? a.name,
		settings: b.settings ?? a.settings,
		trackOrder: b.trackOrder ?? a.trackOrder,
		markers: b.markers ?? a.markers,
		tracks: a.tracks || b.tracks ? { ...a.tracks, ...b.tracks } : undefined,
		clips: a.clips || b.clips ? { ...a.clips, ...b.clips } : undefined,
		assets: a.assets || b.assets ? { ...a.assets, ...b.assets } : undefined,
	}
}

export type HistoryEntry = { label: string; coalesceKey?: string; forward: Patch; backward: Patch; at: number }

export type EngineState = { doc: ProjectDoc; undo: HistoryEntry[]; redo: HistoryEntry[] }

const COALESCE_WINDOW_MS = 600
const MAX_HISTORY = 200

export type EngineListener = (state: EngineState) => void

/**
 * Holds the live document, the undo/redo stacks, and notifies listeners.
 *
 * There is no built-in persistence here on purpose: `components/editor/EditorStudio.tsx`
 * owns *when* to save (debounced autosave via `lib/persist/use-vault.ts`), this
 * class only owns *what is true right now* and how it got there.
 */
export class Engine {
	private state: EngineState
	private listeners = new Set<EngineListener>()

	constructor(doc: ProjectDoc, undo: HistoryEntry[] = [], redo: HistoryEntry[] = []) {
		this.state = { doc, undo, redo }
	}

	getState(): EngineState {
		return this.state
	}

	getDoc(): ProjectDoc {
		return this.state.doc
	}

	subscribe(listener: EngineListener): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private emit(): void {
		for (const listener of this.listeners) listener(this.state)
	}

	/** Replaces the whole state without touching history - used only by session restore. */
	hydrate(doc: ProjectDoc, undo: HistoryEntry[], redo: HistoryEntry[]): void {
		this.state = { doc, undo, redo }
		this.emit()
	}

	dispatch(command: Command): void {
		const doc = applyPatch(this.state.doc, command.forward)
		if (doc === this.state.doc) return

		const undo = this.state.undo.slice()
		const top = undo[undo.length - 1]
		const now = Date.now()

		if (top && command.coalesceKey && top.coalesceKey === command.coalesceKey && now - top.at < COALESCE_WINDOW_MS) {
			// A drag firing many small commands becomes one history entry: keep the
			// original backward (the state before the drag started) and extend
			// forward to cover everything so far.
			undo[undo.length - 1] = { ...top, forward: mergePatch(top.forward, command.forward), at: now }
		} else {
			undo.push({ label: command.label, coalesceKey: command.coalesceKey, forward: command.forward, backward: command.backward, at: now })
			if (undo.length > MAX_HISTORY) undo.shift()
		}

		this.state = { doc, undo, redo: [] }
		this.emit()
	}

	undo(): void {
		const entry = this.state.undo[this.state.undo.length - 1]
		if (!entry) return
		const doc = applyPatch(this.state.doc, entry.backward)
		this.state = { doc, undo: this.state.undo.slice(0, -1), redo: [...this.state.redo, entry] }
		this.emit()
	}

	redo(): void {
		const entry = this.state.redo[this.state.redo.length - 1]
		if (!entry) return
		const doc = applyPatch(this.state.doc, entry.forward)
		this.state = { doc, undo: [...this.state.undo, entry], redo: this.state.redo.slice(0, -1) }
		this.emit()
	}

	canUndo(): boolean {
		return this.state.undo.length > 0
	}

	canRedo(): boolean {
		return this.state.redo.length > 0
	}

	historyLabels(): string[] {
		return this.state.undo.map((entry) => entry.label)
	}
}
