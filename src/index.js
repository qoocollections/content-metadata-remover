// @flow
import { imageGpsExifRemoverSkip } from './imageGpsExifRemover'
import { videoMetadataRemoverSkip } from './videoMetadataRemover'
import type { ReadFunction, WriteFunction, Options } from './metaRemoverHelpers'
import base64 from 'Base64'

const isVideo = uri => /(mp4|m4v|webm|mov)/i.test(uri)

function removeFileSlashPrefix(path: string): string {
  return path.replace(/^(file:\/\/)/, '')
}

export const removeMetadata = async (photoUri: string, read: ReadFunction, write: WriteFunction, options: Options = {}): Promise<boolean> => {
  const optionsWithDefaults = {skipXMPRemoval: false, ...options}
  const { skipXMPRemoval } = optionsWithDefaults
  const preparedUri = removeFileSlashPrefix(photoUri)
  return isVideo(preparedUri)
    ? await videoMetadataRemoverSkip(read, write, skipXMPRemoval)
    : await imageGpsExifRemoverSkip(read, write, skipXMPRemoval)
}

export const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return base64.btoa(binary)
}

export const base64StringToArrayBuffer = async (base64String: string): Promise<Buffer> => {
  const binaryString = await base64.atob(base64String)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}
