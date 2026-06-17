// JS bridge to the native FileExport plugin — writes a UTF-8 text file into the
// device's PUBLIC Downloads folder so it appears in the Downloads app & Recent
// files. Web has no native file system here, so the web stub throws and callers
// fall back to a Blob download.
import { Capacitor, registerPlugin } from '@capacitor/core';

const FileExport = registerPlugin('FileExport', {
  web: () => ({
    saveToDownloads: async () => {
      throw new Error('FileExport is only available on Android.');
    }
  })
});

export const isNativeAndroid = () => Capacitor.getPlatform() === 'android';

/**
 * Save a UTF-8 text file into Downloads (optionally under a sub-folder).
 * @param {{ fileName: string, data: string, subDir?: string, mimeType?: string }} opts
 * @returns {Promise<{ uri: string }>} the saved path / content URI
 */
export async function saveToDownloads({ fileName, data, subDir = '', mimeType = 'application/json' }) {
  return FileExport.saveToDownloads({ fileName, data, subDir, mimeType });
}
