'use client'

/**
 * Every module an uploaded file is allowed to import.
 *
 * The uploaded code is compiled in the browser and executed with a tiny CommonJS
 * shim, so `import {spring} from 'remotion'` has to resolve to the *same* copy of
 * Remotion that the <Player /> uses - otherwise the React contexts would not
 * match and `useCurrentFrame()` would throw.
 */

import * as React from 'react'
import * as ReactJSXRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as Remotion from 'remotion'
import * as RemotionPlayer from '@remotion/player'
import * as RemotionShapes from '@remotion/shapes'
import * as RemotionPaths from '@remotion/paths'
import * as RemotionNoise from '@remotion/noise'
import * as RemotionMotionBlur from '@remotion/motion-blur'
import * as RemotionTransitions from '@remotion/transitions'
import * as RemotionFade from '@remotion/transitions/fade'
import * as RemotionSlide from '@remotion/transitions/slide'
import * as RemotionWipe from '@remotion/transitions/wipe'
import * as RemotionFlip from '@remotion/transitions/flip'
import * as RemotionClockWipe from '@remotion/transitions/clock-wipe'
import * as RemotionMediaUtils from '@remotion/media-utils'
import * as RemotionMedia from '@remotion/media'
import * as RemotionGif from '@remotion/gif'

export const MODULE_REGISTRY: Record<string, unknown> = {
	react: React,
	'react/jsx-runtime': ReactJSXRuntime,
	'react/jsx-dev-runtime': ReactJSXRuntime,
	'react-dom': ReactDOM,
	'react-dom/client': ReactDOMClient,
	remotion: Remotion,
	'@remotion/player': RemotionPlayer,
	'@remotion/shapes': RemotionShapes,
	'@remotion/paths': RemotionPaths,
	'@remotion/noise': RemotionNoise,
	'@remotion/motion-blur': RemotionMotionBlur,
	'@remotion/transitions': RemotionTransitions,
	'@remotion/transitions/fade': RemotionFade,
	'@remotion/transitions/slide': RemotionSlide,
	'@remotion/transitions/wipe': RemotionWipe,
	'@remotion/transitions/flip': RemotionFlip,
	'@remotion/transitions/clock-wipe': RemotionClockWipe,
	'@remotion/media-utils': RemotionMediaUtils,
	'@remotion/media': RemotionMedia,
	'@remotion/gif': RemotionGif,
}

export const SUPPORTED_MODULES = Object.keys(MODULE_REGISTRY)

export { React, Remotion }
