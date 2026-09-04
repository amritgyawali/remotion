import type { VirtualProject } from '../types'
import { projectDurationFrames } from './model'
import type { ProjectDoc } from './types'

/**
 * Compiles the NLE document into a self-contained Remotion project. Media stays
 * in Cloudinary and the render host reads it directly; only the small timeline
 * JSON crosses the app server boundary.
 */
export function editorCloudProject(doc: ProjectDoc): VirtualProject {
	const usedAssetIds = new Set(
		Object.values(doc.clips)
			.flatMap((clip) => clip.enabled && clip.kind !== 'text' && !doc.tracks[clip.trackId]?.hidden ? [clip.assetId] : []),
	)
	const missing = [...usedAssetIds].flatMap((id) => {
		const asset = doc.assets[id]
		return !asset?.cloudUrl ? [asset ?? { name: id }] : []
	})
	if (missing.length > 0) {
		throw new Error(`Waiting for ${missing.length} media ${missing.length === 1 ? 'file' : 'files'} to finish uploading to Cloudinary.`)
	}
	const keyed = Object.values(doc.clips).filter((clip) => clip.effects.chromaKey?.enabled)
	if (keyed.length > 0) {
		throw new Error('Chroma-key clips currently require Local rendering because the cloud compositor cannot reproduce the pixel mask exactly.')
	}

	const duration = Math.max(1, projectDurationFrames(doc))
	const data = JSON.stringify(doc).replace(/</g, '\\u003c')
	const source = `
import React from 'react';
import {AbsoluteFill, Audio, Composition, Img, Sequence, interpolate, useCurrentFrame} from 'remotion';
import {Video} from '@remotion/media';

const doc = ${data};
const clamp = (n) => Math.max(0, Math.min(1, n));
const filterFor = (fx) => [
  fx.brightness !== 1 && \`brightness(\${fx.brightness})\`,
  fx.contrast !== 1 && \`contrast(\${fx.contrast})\`,
  fx.saturation !== 1 && \`saturate(\${fx.saturation})\`,
  fx.hueRotateDeg && \`hue-rotate(\${fx.hueRotateDeg}deg)\`,
  fx.blurPx > 0 && \`blur(\${fx.blurPx}px)\`,
  fx.grayscale > 0 && \`grayscale(\${clamp(fx.grayscale)})\`,
  fx.sepia > 0 && \`sepia(\${clamp(fx.sepia)})\`,
  fx.invert > 0 && \`invert(\${clamp(fx.invert)})\`,
].filter(Boolean).join(' ') || 'none';
const layerStyle = (clip) => ({
  position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain',
  opacity: clip.transform.opacity, filter: filterFor(clip.effects),
	clipPath: clip.effects.crop ? \`inset(\${clip.effects.crop.y*100}% \${(1-clip.effects.crop.x-clip.effects.crop.width)*100}% \${(1-clip.effects.crop.y-clip.effects.crop.height)*100}% \${clip.effects.crop.x*100}%)\` : undefined,
  transform: \`translate(\${clip.transform.x}px, \${clip.transform.y}px) scale(\${clip.transform.scaleX}, \${clip.transform.scaleY}) rotate(\${clip.transform.rotationDeg}deg)\`,
});
const anchor = (position, margin) => {
  const top = position.startsWith('top') ? margin : position === 'center' ? '50%' : 'auto';
  const bottom = position.startsWith('bottom') ? margin : 'auto';
  const left = position.endsWith('left') ? margin : position.endsWith('right') ? 'auto' : '50%';
  const right = position.endsWith('right') ? margin : 'auto';
  return {top, bottom, left, right};
};
const TextLayer = ({clip}) => {
  const frame = useCurrentFrame();
  const n = Math.max(1, clip.text.animationFrames);
  const inP = interpolate(frame, [0, n], [0, 1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  const outP = interpolate(frame, [Math.max(0, clip.durationFrames-n), clip.durationFrames], [1, 0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  const p = Math.min(inP, outP);
  const animated = clip.text.animationIn === 'pop' ? \`scale(\${0.75 + p * 0.25})\` : clip.text.animationIn === 'slide-up' ? \`translateY(\${(1-p)*32}px)\` : clip.text.animationIn === 'slide-down' ? \`translateY(\${(p-1)*32}px)\` : '';
  const fade = clip.text.animationIn === 'fade' || clip.text.animationOut === 'fade';
  return <div style={{...anchor(clip.text.position, clip.text.marginPx), position:'absolute', maxWidth:'90%', padding:clip.text.backgroundColor ? '0.18em 0.35em' : 0, borderRadius:8, background:clip.text.backgroundColor || undefined, color:clip.text.color, fontFamily:clip.text.fontFamily, fontSize:clip.text.fontSizePx, fontWeight:clip.text.weight, textAlign:clip.text.align, whiteSpace:'pre-wrap', transform:\`translate(\${clip.text.position.endsWith('left') || clip.text.position.endsWith('right') ? '0' : '-50%'}, \${clip.text.position === 'center' ? '-50%' : '0'}) \${animated}\`, opacity:clip.transform.opacity * (fade ? p : 1), WebkitTextStroke:clip.text.strokeWidthPx ? \`\${clip.text.strokeWidthPx}px \${clip.text.strokeColor}\` : undefined}}>{clip.text.content}</div>;
};
const Layer = ({clip}) => {
  const track = doc.tracks[clip.trackId];
  if (!clip.enabled || !track || track.hidden) return null;
  if (clip.kind === 'text') return <TextLayer clip={clip}/>;
  const asset = doc.assets[clip.assetId];
  if (!asset?.cloudUrl) return null;
  const muted = track.muted || clip.audio.muted;
  const volume = muted ? 0 : Math.pow(10, clip.audio.gainDb / 20);
  if (clip.kind === 'audio') return <Audio src={asset.cloudUrl} trimBefore={Math.round(clip.sourceInSeconds * doc.settings.fps)} playbackRate={clip.speed} volume={volume}/>;
  if (clip.kind === 'image') return <Img src={asset.cloudUrl} style={layerStyle(clip)}/>;
  if (clip.freezeFrame) {
    const still = asset.cloudUrl.replace('/video/upload/', \`/video/upload/so_\${clip.sourceInSeconds},f_jpg/\`);
    return <Img src={still} style={layerStyle(clip)}/>;
  }
  return <Video src={asset.cloudUrl} trimBefore={Math.round(clip.sourceInSeconds * doc.settings.fps)} playbackRate={clip.speed} muted={muted} volume={volume} style={layerStyle(clip)}/>;
};
const Timeline = () => <AbsoluteFill style={{backgroundColor:doc.settings.backgroundColor}}>{doc.trackOrder.flatMap((trackId) => Object.values(doc.clips).filter((clip) => clip.trackId === trackId).sort((a,b) => a.startFrame-b.startFrame)).map((clip) => <Sequence key={clip.id} from={clip.startFrame} durationInFrames={clip.durationFrames} layout="none"><Layer clip={clip}/></Sequence>)}</AbsoluteFill>;
export const RemotionRoot = () => <Composition id="EditorTimeline" component={Timeline} width={doc.settings.width} height={doc.settings.height} fps={doc.settings.fps} durationInFrames={${duration}}/>;
`

	return {
		name: doc.name || 'Editor timeline',
		entry: 'index.tsx',
		files: [{ path: 'index.tsx', contents: source }],
	}
}
