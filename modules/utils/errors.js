/**
 * Creates an error that route handlers can expose as a client input failure.
 *
 * @param {string} message Explanation suitable for the API client.
 * @returns {Error & {statusCode: number}} Error marked with HTTP status code 400.
 */
function userInputError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

module.exports = {
  userInputError
}
