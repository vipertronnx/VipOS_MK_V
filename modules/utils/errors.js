function userInputError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

module.exports = {
  userInputError
}
