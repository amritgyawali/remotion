/**
 * The vocabulary cloud mode speaks, shared by the browser and the routes.
 *
 * Nothing in here is secret and nothing imports a server module, so a client
 * component can hold these types without dragging a credential into the bundle.
 */

export type StudioId = 'video' | 'captions' | 'silence' | 'tools' | 'editor' | 'resume'

/** Where the heavy work happens. This is the whole feature, in one union. */
export type RunLocation = 'device' | 'cloud'

export type CloudResourceType = 'video' | 'image' | 'raw'
export type CloudAssetKind = 'source' | 'output' | 'overlay' | 'subtitle' | 'poster'

export type CloudAsset = {
	id: string
	publicId: string
	resourceType: CloudResourceType
	kind: CloudAssetKind
	format: string | null
	bytes: number | null
	duration: number | null
	width: number | null
	height: number | null
	secureUrl: string
	originalName: string | null
	createdAt: string
}

export function normalizeCloudAsset(value: unknown): CloudAsset | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	const item = value as Record<string, unknown>
	if (typeof item.id !== 'string' || typeof item.publicId !== 'string' || typeof item.secureUrl !== 'string') return null
	if (!['video', 'image', 'raw'].includes(String(item.resourceType))) return null
	if (!['source', 'output', 'overlay', 'subtitle', 'poster'].includes(String(item.kind))) return null
	const nullableNumber = (entry: unknown) => typeof entry === 'number' && Number.isFinite(entry) ? entry : null
	return {
		id: item.id,
		publicId: item.publicId,
		resourceType: item.resourceType as CloudResourceType,
		kind: item.kind as CloudAssetKind,
		format: typeof item.format === 'string' ? item.format : null,
		bytes: nullableNumber(item.bytes),
		duration: nullableNumber(item.duration),
		width: nullableNumber(item.width),
		height: nullableNumber(item.height),
		secureUrl: item.secureUrl,
		originalName: typeof item.originalName === 'string' ? item.originalName : null,
		createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
	}
}

export type CloudProjectSummary = {
	id: string
	studio: StudioId
	name: string
	version: number
	posterUrl: string | null
	updatedAt: string
	createdAt: string
}

export type CloudProject<T = unknown> = CloudProjectSummary & { data: T }

export type CloudJobKind = 'transform' | 'render' | 'transcode'
export type CloudJobStatus = 'queued' | 'running' | 'ready' | 'failed'

export type CloudJobResult = {
	url: string
	publicId: string
	resourceType: CloudResourceType
	format: string | null
	bytes: number | null
	duration: number | null
	width: number | null
	height: number | null
	/** the derived asset a transform produced, when it is not a new upload */
	derived?: boolean
}

export type CloudJob = {
	id: string
	kind: CloudJobKind
	status: CloudJobStatus
	label: string | null
	tool: string | null
	progress: number
	transformation: string | null
	sourcePublicId: string | null
	result: CloudJobResult | null
	error: string | null
	createdAt: string
	updatedAt: string
}

export type CloudIdentity = {
	/** `user:<uuid>` when signed in, `device:<hash>` otherwise */
	owner: string
	signedIn: boolean
	email: string | null
}

export type CloudStatus = {
	enabled: boolean
	media: boolean
	store: boolean
	cloudName: string
	maxVideoBytes: number
	maxImageBytes: number
	maxRawBytes: number
	identity: CloudIdentity | null
	/** true when the Remotion server renderer is also reachable */
	serverRender: boolean
}

export type SignedUpload = {
	uploadUrl: string
	cloudName: string
	apiKey: string
	timestamp: number
	signature: string
	publicId: string
	folder: string
	resourceType: CloudResourceType
	/** bytes this upload may not exceed, straight from the plan */
	maxBytes: number
}
