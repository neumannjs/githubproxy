module.exports = async function (context, req) {
  context.log('Proxy Github redirect')

  const state = decodeURI(req.query.state)
  const indexOfHttp = state.search(/https?:\/\//i)
  // TODO: State should also contain a real state, to improve security
  if (req.query.code && indexOfHttp > -1) {
    const redirectUrl = state.substring(indexOfHttp) + '?code=' + encodeURI(req.query.code) + '&state=' + encodeURI(req.query.state)
    context.res = {
      status: 302,
      headers: {
        location: redirectUrl
      },
      body: null
    }
    context.done()
  } else {
    context.res = {
      status: 500,
      body: 'Incorrect request'
    }
    context.done()
  }
}
