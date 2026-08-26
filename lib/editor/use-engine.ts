'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { Engine, type EngineState, type HistoryEntry } from './commands'
import type { ProjectDoc } from './types'

/**
 * Binds one `Engine` instance to React via `useSyncExternalStore`, so every
 * dispatch, undo or redo re-renders exactly the components reading `doc` -
 * no reducer boilerplate, and no risk of a render seeing a stale document
 * because `Engine` itself is the single source of truth, not a React state
 * variable mirroring it.
 */
export function useEngine(initialDoc: ProjectDoc, initialUndo: HistoryEntry[] = [], initialRedo: HistoryEntry[] = []): Engine {
	const engine = useMemo(() => new Engine(initialDoc, initialUndo, initialRedo), []) // eslint-disable-line react-hooks/exhaustive-deps
	return engine
}

export function useEngineState(engine: Engine): EngineState {
	return useSyncExternalStore(
		(onChange) => engine.subscribe(onChange),
		() => engine.getState(),
		() => engine.getState(),
	)
}
