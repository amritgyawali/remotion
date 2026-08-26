/**
 * TypeScript's bundled `lib.dom.d.ts` ships `FileSystemFileHandle` but not
 * yet the permission methods or the picker functions (Chromium/Edge only,
 * not yet in every browser) - so the parts this studio actually calls are
 * declared here. `handleSupported()` in `lib/editor/handles.ts` is what
 * decides at runtime whether any of this exists at all.
 */

type FileSystemPermissionMode = 'read' | 'readwrite'

interface FileSystemHandlePermissionDescriptor {
	mode?: FileSystemPermissionMode
}

interface FileSystemHandle {
	queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
	requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
}

interface FileSystemFileHandle {
	createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>
}

interface FileSystemWritableFileStream extends WritableStream {
	write(data: BufferSource | Blob | string): Promise<void>
	seek(position: number): Promise<void>
	truncate(size: number): Promise<void>
}

interface OpenFilePickerOptions {
	multiple?: boolean
	excludeAcceptAllOption?: boolean
	types?: Array<{ description?: string; accept: Record<string, string[]> }>
}

interface SaveFilePickerOptions {
	suggestedName?: string
	types?: Array<{ description?: string; accept: Record<string, string[]> }>
}

interface Window {
	showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>
	showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
}
