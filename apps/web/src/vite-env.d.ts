/// <reference types="svelte" />
/// <reference types="vite/client" />

/**
 * The File System Access permission API.
 *
 * `queryPermission` and `requestPermission` are part of the spec and shipped in
 * Chromium, but are not in TypeScript's DOM library. Declared here rather than
 * cast at each call site, so the optional-call syntax at the call site still
 * means "this browser may not have it".
 */
interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemDirectoryHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}
