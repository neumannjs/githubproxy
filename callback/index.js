module.exports = async function (context, req) {
    context.log('Proxy Github redirect')

    let state = decodeURI(req.query.state)
    let indexOfHttp = state.search(/https?:\/\//i)

    if (req.query.code && indexOfHttp > -1) {
        let redirectUrl = state.substring(indexOfHttp) + '?code=' + encodeURI(req.query.code) + '&state=' + encodeURI(req.query.state)
        context.res = {
            status: 302,
            headers: {
                'location': redirectUrl
            },
            body: null
        }
        context.done()
    }
    else {
        context.res = {
            status: 500,
            body: "Incorrect request"
        }
        context.done()
    }
};