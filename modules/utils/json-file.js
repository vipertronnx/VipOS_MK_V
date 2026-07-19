const fs = require('fs')
const path = require('path')

let nextTemporaryFileId = 1

/**
 * Writes formatted JSON to a sibling temporary file before replacing the destination.
 *
 * @param {string} file Destination file path; missing parent directories are created.
 * @param {*} value JSON-serializable value to persist.
 * @throws {Error} Rethrows filesystem or serialization failures after attempting temporary-file cleanup.
 */
function writeJsonFile(file, value) {
  const tempFile = `${file}.${process.pid}.${Date.now()}.${nextTemporaryFileId++}.tmp`

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`)
    replaceFile(tempFile, file)
  } catch (error) {
    cleanupTempFile(tempFile)
    throw error
  }
}

/**
 * Wraps a storage failure as a service-unavailable error while preserving its cause.
 *
 * @param {string} label Operation-specific context for the error message.
 * @param {Error} cause Underlying persistence failure.
 * @returns {Error & {cause: Error, statusCode: number}} Error marked with HTTP status code 503.
 */
function createPersistenceError(label, cause) {
  const error = new Error(`${label}: ${cause.message}`)
  error.cause = cause
  error.statusCode = 503
  return error
}

/**
 * Replaces a target file by rename, with a copy-and-delete fallback for access or permission failures.
 *
 * @param {string} tempFile Completed temporary file path.
 * @param {string} targetFile File to replace.
 * @throws {Error} Throws for non-permission rename failures or unsuccessful fallback copy/delete operations.
 */
function replaceFile(tempFile, targetFile) {
  try {
    fs.renameSync(tempFile, targetFile)
  } catch (error) {
    if (!['EACCES', 'EPERM'].includes(error.code)) throw error
    fs.copyFileSync(tempFile, targetFile)
    fs.unlinkSync(tempFile)
  }
}

function cleanupTempFile(tempFile) {
  try {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
  } catch {
    // Preserve the original write failure.
  }
}

module.exports = {
  createPersistenceError,
  writeJsonFile
}
