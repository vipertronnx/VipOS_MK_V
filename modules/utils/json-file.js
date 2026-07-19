const fs = require('fs')
const path = require('path')

let nextTemporaryFileId = 1

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

function createPersistenceError(label, cause) {
  const error = new Error(`${label}: ${cause.message}`)
  error.cause = cause
  error.statusCode = 503
  return error
}

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
