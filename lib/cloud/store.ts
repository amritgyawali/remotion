import 'server-only'

/**
 * Reading and writing the three cloud tables.
 *
 * Every function here takes an `owner` and puts it in the where clause. That is
 * not decoration: the service client bypasses row level security, so this file
 * *is* the access control for anonymous device rows. A query that forgets the
 * owner filter would hand one visitor another's projects, so there is exactly
 * one place to get it right and nothing else touches these tables.
 */

import { createServiceClient } from '../../utils/supabase/server'
import type {
	CloudAsset,
	CloudAssetKind,
	CloudJob,
	CloudJobKind,
	CloudJobResult,
	CloudJobStatus,
	CloudProject,
	CloudProjectSummary,
	CloudResourceType,
	StudioId,
} from './types'

function client() {
	const supabase = createServiceClient()
	if (!supabase) throw new Error('Supabase is not configured on this server.')
	return supabase
}

/** Supabase errors carry a message worth showing; anything else must not leak. */
function fail(context: string, error: { message?: string } | null): never {
	throw new Error(`${context}: ${error?.message ?? 'unknown database error'}`)
}

/* --------------------------------------------------------------- projects */

type ProjectRow = {
	id: string
	studio: StudioId
	name: string
	version: number
	poster_url: string | null
	data?: unknown
	created_at: string
	updated_at: string
}

function toSummary(row: ProjectRow): CloudProjectSummary {
	return {
		id: row.id,
		studio: row.studio,
		name: row.name,
		version: row.version,
		posterUrl: row.poster_url,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}
}

export async function listProjects(args: {
	owner: string
	studio?: StudioId
	limit?: number
}): Promise<CloudProjectSummary[]> {
	let query = client()
		.from('studio_projects')
		.select('id, studio, name, version, poster_url, created_at, updated_at')
		.eq('owner', args.owner)
		.order('updated_at', { ascending: false })
		.limit(Math.min(args.limit ?? 50, 200))

	if (args.studio) query = query.eq('studio', args.studio)

	const { data, error } = await query
	if (error) fail('Could not list cloud projects', error)
	return (data as ProjectRow[]).map(toSummary)
}

export async function readProject(args: {
	owner: string
	id: string
}): Promise<CloudProject | null> {
	const { data, error } = await client()
		.from('studio_projects')
		.select('id, studio, name, version, poster_url, data, created_at, updated_at')
		.eq('owner', args.owner)
		.eq('id', args.id)
		.maybeSingle()

	if (error) fail('Could not open that cloud project', error)
	if (!data) return null
	const row = data as ProjectRow
	return { ...toSummary(row), data: row.data ?? null }
}

export async function writeProject(args: {
	owner: string
	userId: string | null
	id?: string | null
	studio: StudioId
	name: string
	version: number
	data: unknown
	posterUrl?: string | null
}): Promise<CloudProjectSummary> {
	const supabase = client()
	const fields = {
		owner: args.owner,
		user_id: args.userId,
		studio: args.studio,
		name: args.name.slice(0, 160) || 'Untitled',
		version: args.version,
		data: args.data ?? {},
		poster_url: args.posterUrl ?? null,
	}

	if (args.id) {
		// The owner filter is what stops an id from someone else's session being
		// overwritten - an update that matches no row returns no row, not a write.
		const { data, error } = await supabase
			.from('studio_projects')
			.update(fields)
			.eq('id', args.id)
			.eq('owner', args.owner)
			.select('id, studio, name, version, poster_url, created_at, updated_at')
			.maybeSingle()
		if (error) fail('Could not save to the cloud', error)
		if (data) return toSummary(data as ProjectRow)
		// Falls through to an insert: the id belonged to a project that is gone.
	}

	const { data, error } = await supabase
		.from('studio_projects')
		.insert(fields)
		.select('id, studio, name, version, poster_url, created_at, updated_at')
		.single()
	if (error) fail('Could not save to the cloud', error)
	return toSummary(data as ProjectRow)
}

export async function deleteProject(args: { owner: string; id: string }): Promise<void> {
	const { error } = await client()
		.from('studio_projects')
		.delete()
		.eq('owner', args.owner)
		.eq('id', args.id)
	if (error) fail('Could not delete that cloud project', error)
}

/* ----------------------------------------------------------------- assets */

type AssetRow = {
	id: string
	public_id: string
	resource_type: CloudResourceType
	kind: CloudAssetKind
	format: string | null
	bytes: number | null
	duration: number | null
	width: number | null
	height: number | null
	secure_url: string
	original_name: string | null
	created_at: string
}

const ASSET_COLUMNS =
	'id, public_id, resource_type, kind, format, bytes, duration, width, height, secure_url, original_name, created_at'

function toAsset(row: AssetRow): CloudAsset {
	return {
		id: row.id,
		publicId: row.public_id,
		resourceType: row.resource_type,
		kind: row.kind,
		format: row.format,
		bytes: row.bytes,
		duration: row.duration,
		width: row.width,
		height: row.height,
		secureUrl: row.secure_url,
		originalName: row.original_name,
		createdAt: row.created_at,
	}
}

export async function recordAsset(args: {
	owner: string
	userId: string | null
	projectId?: string | null
	publicId: string
	resourceType: CloudResourceType
	kind: CloudAssetKind
	format?: string | null
	bytes?: number | null
	duration?: number | null
	width?: number | null
	height?: number | null
	secureUrl: string
	originalName?: string | null
}): Promise<CloudAsset> {
	const { data, error } = await client()
		.from('studio_assets')
		.insert({
			owner: args.owner,
			user_id: args.userId,
			project_id: args.projectId ?? null,
			public_id: args.publicId,
			resource_type: args.resourceType,
			kind: args.kind,
			format: args.format ?? null,
			bytes: args.bytes ?? null,
			duration: args.duration ?? null,
			width: args.width ?? null,
			height: args.height ?? null,
			secure_url: args.secureUrl,
			original_name: args.originalName ?? null,
		})
		.select(ASSET_COLUMNS)
		.single()
	if (error) fail('Could not record that upload', error)
	return toAsset(data as AssetRow)
}

export async function listAssets(args: {
	owner: string
	kind?: CloudAssetKind
	limit?: number
}): Promise<CloudAsset[]> {
	let query = client()
		.from('studio_assets')
		.select(ASSET_COLUMNS)
		.eq('owner', args.owner)
		.order('created_at', { ascending: false })
		.limit(Math.min(args.limit ?? 60, 200))

	if (args.kind) query = query.eq('kind', args.kind)

	const { data, error } = await query
	if (error) fail('Could not list cloud media', error)
	return (data as AssetRow[]).map(toAsset)
}

export async function readAsset(args: { owner: string; id: string }): Promise<CloudAsset | null> {
	const { data, error } = await client()
		.from('studio_assets')
		.select(ASSET_COLUMNS)
		.eq('owner', args.owner)
		.eq('id', args.id)
		.maybeSingle()
	if (error) fail('Could not open that cloud file', error)
	return data ? toAsset(data as AssetRow) : null
}

export async function forgetAsset(args: { owner: string; id: string }): Promise<CloudAsset | null> {
	const { data, error } = await client()
		.from('studio_assets')
		.delete()
		.eq('owner', args.owner)
		.eq('id', args.id)
		.select(ASSET_COLUMNS)
		.maybeSingle()
	if (error) fail('Could not delete that cloud file', error)
	return data ? toAsset(data as AssetRow) : null
}

/* ------------------------------------------------------------------- jobs */

type JobRow = {
	id: string
	kind: CloudJobKind
	status: CloudJobStatus
	label: string | null
	tool: string | null
	progress: number
	transformation: string | null
	source_public_id: string | null
	result: CloudJobResult | null
	error: string | null
	created_at: string
	updated_at: string
}

const JOB_COLUMNS =
	'id, kind, status, label, tool, progress, transformation, source_public_id, result, error, created_at, updated_at'

function toJob(row: JobRow): CloudJob {
	return {
		id: row.id,
		kind: row.kind,
		status: row.status,
		label: row.label,
		tool: row.tool,
		progress: row.progress,
		transformation: row.transformation,
		sourcePublicId: row.source_public_id,
		result: row.result,
		error: row.error,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}
}

export async function createJob(args: {
	owner: string
	userId: string | null
	projectId?: string | null
	kind: CloudJobKind
	label?: string | null
	tool?: string | null
	params?: unknown
	sourcePublicId?: string | null
	transformation?: string | null
	status?: CloudJobStatus
	result?: CloudJobResult | null
}): Promise<CloudJob> {
	const { data, error } = await client()
		.from('studio_jobs')
		.insert({
			owner: args.owner,
			user_id: args.userId,
			project_id: args.projectId ?? null,
			kind: args.kind,
			status: args.status ?? 'queued',
			label: args.label ?? null,
			tool: args.tool ?? null,
			params: args.params ?? {},
			source_public_id: args.sourcePublicId ?? null,
			transformation: args.transformation ?? null,
			result: args.result ?? null,
		})
		.select(JOB_COLUMNS)
		.single()
	if (error) fail('Could not queue that cloud job', error)
	return toJob(data as JobRow)
}

export async function readJob(args: { owner: string; id: string }): Promise<CloudJob | null> {
	const { data, error } = await client()
		.from('studio_jobs')
		.select(JOB_COLUMNS)
		.eq('owner', args.owner)
		.eq('id', args.id)
		.maybeSingle()
	if (error) fail('Could not read that cloud job', error)
	return data ? toJob(data as JobRow) : null
}

export async function updateJob(args: {
	owner: string
	id: string
	status?: CloudJobStatus
	progress?: number
	result?: CloudJobResult | null
	error?: string | null
}): Promise<CloudJob | null> {
	const patch: Record<string, unknown> = {}
	if (args.status !== undefined) patch.status = args.status
	if (args.progress !== undefined) patch.progress = args.progress
	if (args.result !== undefined) patch.result = args.result
	if (args.error !== undefined) patch.error = args.error

	const { data, error } = await client()
		.from('studio_jobs')
		.update(patch)
		.eq('owner', args.owner)
		.eq('id', args.id)
		.select(JOB_COLUMNS)
		.maybeSingle()
	if (error) fail('Could not update that cloud job', error)
	return data ? toJob(data as JobRow) : null
}

export async function listJobs(args: { owner: string; limit?: number }): Promise<CloudJob[]> {
	const { data, error } = await client()
		.from('studio_jobs')
		.select(JOB_COLUMNS)
		.eq('owner', args.owner)
		.order('created_at', { ascending: false })
		.limit(Math.min(args.limit ?? 30, 100))
	if (error) fail('Could not list cloud jobs', error)
	return (data as JobRow[]).map(toJob)
}
